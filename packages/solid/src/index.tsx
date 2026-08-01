import type { JSX } from "solid-js"

import {
  createCompiledMessageRuntime,
  formatMessageArgument,
  parseMessagePattern,
  replacePoundPlaceholders,
  resolveChoice,
  stringifyValue,
} from "@palamedes/core"
import type {
  CompiledMessageRuntime,
  MessageMetadata,
  MessageNode,
  PalamedesI18n,
} from "@palamedes/core"

import { getI18n } from "./runtime"

export {
  buildLocaleSwitchItems,
  type BuildLocaleSwitchItemsOptions,
  type LocaleSwitchItem,
} from "@palamedes/core/locale"

// Read the active i18n while registering the enclosing Solid computation as a
// subscriber, so it re-runs when the client locale changes. The components below
// return accessors (plain functions), which Solid tracks — that is where this
// read is picked up.
function useReactiveI18n(): PalamedesI18n {
  return getI18n<PalamedesI18n>()
}

type WrapperComponent = (children: JSX.Element) => JSX.Element

export type TransProps = {
  // `id` is optional in authored source: components are written with `message`
  // (or choice props) and the Palamedes compiler transform injects the resolved
  // `id` at build time. Hand-written runtime usage may still pass `id` directly.
  id?: string
  message?: string
  context?: string
  comment?: string
  values?: Record<string, unknown>
  components?: Record<string, WrapperComponent | JSX.Element>
}

type ChoiceComponentProps = {
  value: string | number
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string
} & // Exact matches use the `_N` prop spelling (`_0`, `_1`, …) because JSX
  // attributes cannot start with `=`; they are normalized to ICU `=N` options,
  // mirroring the macro transform.
  Record<`_${number}`, string>

export type PluralProps = ChoiceComponentProps & {
  offset?: number
}

export type SelectOrdinalProps = ChoiceComponentProps & {
  offset?: number
}

export type SelectProps = {
  value: string | number
  other: string
  [key: string]: string | number | undefined
}

export function Trans({
  id,
  message,
  values,
  components,
  context,
  comment,
}: TransProps): JSX.Element {
  const resolvedId = id ?? message ?? ""

  // Returning an accessor (a plain function) makes Solid track it: it re-runs on
  // a client locale switch, so the rendered nodes follow the active i18n.
  return (() => {
    const i18n = useReactiveI18n()
    const metadata: MessageMetadata = {
      message,
      context,
      comment,
    }
    const runtime = createSolidMessageRuntime(i18n.locale, components ?? {})
    return i18n.renderMessage(resolvedId, values ?? {}, runtime, metadata)
  }) as unknown as JSX.Element
}

/*
 * The choice components resolve through the i18n instance exactly like Trans:
 * the synthesized ICU pattern is the source message, the catalog can override
 * it (when an `id` mapping exists), and rendering shares the same node
 * pipeline. Formatting the source props directly — the previous behavior —
 * silently skipped translation entirely.
 */
function renderChoice(
  kind: "plural" | "select" | "selectordinal",
  value: string | number,
  choices: Record<string, string | number | undefined>,
  offset?: number
): JSX.Element {
  return (() => {
    const i18n = useReactiveI18n()
    const message = buildChoiceMessage("value", kind, choices, offset)
    const metadata: MessageMetadata = { message, reportMissing: false }
    const runtime = createSolidMessageRuntime(i18n.locale, {})
    return i18n.renderMessage(message, { value }, runtime, metadata)
  }) as unknown as JSX.Element
}

export function Plural({ value, offset, ...choices }: PluralProps): JSX.Element {
  return renderChoice("plural", value, choices, offset)
}

export function SelectOrdinal({ value, offset, ...choices }: SelectOrdinalProps): JSX.Element {
  return renderChoice("selectordinal", value, choices, offset)
}

export function Select({ value, ...choices }: SelectProps): JSX.Element {
  return renderChoice("select", value, choices)
}

const PLURAL_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"])

function buildChoiceMessage(
  variable: string,
  kind: "plural" | "select" | "selectordinal",
  choices: Record<string, string | number | undefined>,
  offset?: number
): string {
  validatePluralOffset(offset)
  const entries = Object.entries(choices).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  )
  // Without this the synthesized pattern is `{value, plural,  }`, which parses
  // into a choice with no branches and renders as an empty string — a message
  // that silently disappears instead of reporting the mistake.
  if (entries.length === 0) {
    throw new RangeError(
      `The ${kind} component requires at least one string option (for example other="…").`
    )
  }

  const keys = entries.map(([key]) => normalizeChoiceKey(kind, key))
  const parts = entries.map(([key, value], index) => `${keys[index]} {${value}}`)
  const offsetPart = offset === undefined ? "" : ` offset:${offset}`
  const message = `{${variable}, ${kind},${offsetPart} ${parts.join(" ")}}`
  assertParseableChoiceMessage(message, kind, keys)
  return message
}

/*
 * Mirrors the macro transform's option-key rules: select keys pass through
 * verbatim; plural/selectordinal keys must be a plural category or an exact
 * match written as `_N`/`=N`, which normalizes to ICU `=N`. Anything else was
 * previously emitted verbatim and could never match at runtime.
 */
function normalizeChoiceKey(kind: "plural" | "select" | "selectordinal", key: string): string {
  if (kind === "select") {
    return key
  }

  if (PLURAL_CATEGORIES.has(key)) {
    return key
  }

  const exact = key.startsWith("_") || key.startsWith("=") ? key.slice(1) : undefined
  if (exact !== undefined && /^\d+$/.test(exact)) {
    return `=${exact}`
  }

  throw new RangeError(
    `Invalid ${kind} option "${key}". Use a plural category (zero, one, two, few, many, other) or an exact match such as _0.`
  )
}

/*
 * Guards against option text with unbalanced braces silently corrupting the
 * synthesized pattern (e.g. `other="a } b"` producing a pattern that parses
 * into something unrelated).
 */
function assertParseableChoiceMessage(message: string, kind: string, expectedKeys: string[]): void {
  let parsed: MessageNode[]
  try {
    parsed = parseMessagePattern(message)
  } catch (error) {
    throw new RangeError(
      `Choice options for the ${kind} component produced an invalid ICU pattern (${message}): ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error }
    )
  }

  const node = parsed.length === 1 && parsed[0]?.type === "choice" ? parsed[0] : undefined
  const parsedKeys = node ? Object.keys(node.options) : []
  const intact =
    node !== undefined &&
    parsedKeys.length === expectedKeys.length &&
    // Own-property only: `key in options` would count Object.prototype members
    // as intact branches for option names like "toString".
    expectedKeys.every((key) => Object.hasOwn(node.options, key))

  if (!intact) {
    throw new RangeError(
      `Choice options for the ${kind} component produced an invalid ICU pattern (${message}). Check option text for unbalanced "{" or "}" characters.`
    )
  }
}

function validatePluralOffset(offset: number | undefined): void {
  if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) {
    throw new RangeError("Plural offset must be a non-negative safe integer.")
  }
}

function createSolidMessageRuntime(
  locale: string,
  components: Record<string, WrapperComponent | JSX.Element>
): CompiledMessageRuntime<JSX.Element[]> {
  const runtime: CompiledMessageRuntime<JSX.Element[]> = createCompiledMessageRuntime<
    JSX.Element[]
  >(locale, {
    pattern(pattern, values) {
      return renderNodes(parseMessagePattern(pattern), values, runtime, locale)
    },
    join(...parts) {
      return parts.flatMap((part) => (typeof part === "string" ? [part] : part))
    },
    value(value) {
      return [renderVariable(value)]
    },
    number(value, style) {
      return [formatMessageArgument("number", value, style, locale)]
    },
    date(value, style) {
      return [formatMessageArgument("date", value, style, locale)]
    },
    time(value, style) {
      return [formatMessageArgument("time", value, style, locale)]
    },
    pound(value) {
      return [replacePoundPlaceholders("#", value, locale)]
    },
    literal(value) {
      return [value]
    },
    tag(name, children) {
      const component = components[name]
      if (typeof component === "function") {
        return [component(children as unknown as JSX.Element)]
      }
      if (component !== undefined && component !== null) {
        return [component as JSX.Element]
      }
      return children
    },
  })
  return runtime
}

function renderNodes(
  nodes: MessageNode[],
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<JSX.Element[]>,
  locale: string,
  pluralValue?: number
): JSX.Element[] {
  return nodes.flatMap((node) => renderNode(node, values, runtime, locale, pluralValue))
}

function renderNode(
  node: MessageNode,
  values: Record<string, unknown>,
  runtime: CompiledMessageRuntime<JSX.Element[]>,
  locale: string,
  pluralValue?: number
): JSX.Element[] {
  switch (node.type) {
    case "text": {
      return [
        pluralValue === undefined
          ? node.value
          : replacePoundPlaceholders(node.value, pluralValue, locale),
      ]
    }
    case "literal": {
      return runtime.literal(node.value)
    }
    case "variable": {
      return runtime.value(values, node.name)
    }
    case "formatted": {
      return runtime[node.format](values, node.variable, node.style)
    }
    case "tag": {
      return runtime.tag(
        node.name,
        renderNodes(node.children, values, runtime, locale, pluralValue)
      )
    }
    case "choice": {
      const resolved = resolveChoice(node, values[node.variable], locale)
      const nextPluralValue = node.kind === "select" ? pluralValue : resolved.pluralValue
      return renderNodes(resolved.nodes, values, runtime, locale, nextPluralValue)
    }
  }
}

function renderVariable(value: unknown): JSX.Element {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  // Same stringification as the core string renderer (`i18n._`), so Dates
  // render as deterministic ISO strings on server and client alike.
  if (value instanceof Date) {
    return stringifyValue(value)
  }

  return value as JSX.Element
}
