import * as React from "react"
import { cloneElement, Fragment, isValidElement } from "react"
import type { ReactElement, ReactNode } from "react"

import {
  formatMessagePattern,
  parseMessagePattern,
  replacePoundPlaceholders,
  resolveChoice,
  stringifyValue,
} from "@palamedes/core"
import type { MessageMetadata, MessageNode, PalamedesI18n } from "@palamedes/core"

export type TransProps = {
  // `id` is optional in authored source: components are written with `message`
  // (or choice props) and the Palamedes compiler transform injects the resolved
  // `id` at build time. Hand-written runtime usage may still pass `id` directly.
  id?: string
  message?: string
  context?: string
  comment?: string
  values?: Record<string, unknown>
  components?: Record<string, ReactElement>
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

export function createRuntimeComponents(useI18n: () => PalamedesI18n) {
  function Trans({ id, message, values, components, context, comment }: TransProps): ReactNode {
    const i18n = useI18n()
    const resolvedId = id ?? message ?? ""
    const metadata: MessageMetadata = {
      message,
      context,
      comment,
    }
    const nodes = i18n.getMessageNodes(resolvedId, metadata)
    return <>{renderResilient(i18n, resolvedId, metadata, nodes, values ?? {}, components ?? {})}</>
  }

  /*
   * The choice components resolve through the i18n instance exactly like
   * Trans: the synthesized ICU pattern is the source message, the catalog can
   * override it (when an `id` mapping exists), and rendering shares the same
   * node pipeline. Formatting the source props directly — the previous
   * behavior — silently skipped translation entirely.
   */
  function renderChoice(
    i18n: PalamedesI18n,
    kind: "plural" | "select" | "selectordinal",
    value: string | number,
    choices: Record<string, string | number | undefined>,
    offset?: number
  ): ReactNode {
    const message = buildChoiceMessage("value", kind, choices, offset)
    const metadata: MessageMetadata = { message, reportMissing: false }
    const nodes = i18n.getMessageNodes(message, metadata)
    return <>{renderResilient(i18n, message, metadata, nodes, { value }, {})}</>
  }

  function Plural({ value, offset, ...choices }: PluralProps): ReactNode {
    return renderChoice(useI18n(), "plural", value, choices, offset)
  }

  function SelectOrdinal({ value, offset, ...choices }: SelectOrdinalProps): ReactNode {
    return renderChoice(useI18n(), "selectordinal", value, choices, offset)
  }

  function Select({ value, ...choices }: SelectProps): ReactNode {
    return renderChoice(useI18n(), "select", value, choices)
  }

  return { Plural, Select, SelectOrdinal, Trans }
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

/*
 * Rendering nodes must degrade exactly like core's string renderer.
 * `i18n._()` reports a broken message through `onError` and falls back to the
 * source, but the component path walks the nodes itself: an error thrown here
 * (most easily a translator-introduced plural resolved against an absent or
 * non-numeric value) escapes the component render, takes the surrounding tree
 * down and never reaches `onError`. The whole walk is wrapped, not just the
 * choice case, so every node type shares the contract.
 */
function renderResilient(
  i18n: PalamedesI18n,
  id: string,
  metadata: MessageMetadata,
  nodes: MessageNode[],
  values: Record<string, unknown>,
  components: Record<string, ReactElement>
): ReactNode[] {
  try {
    return renderNodes(nodes, values, components, i18n.locale)
  } catch (error) {
    const fallback = metadata.message ?? id
    // Resolve again (without a second missing report) purely to tell telemetry
    // which pattern actually failed: the catalog entry or the source message.
    const pattern = i18n.getMessage(id, { ...metadata, reportMissing: false })
    // Guarded: instances reach the adapters through the untyped global runtime
    // bridge and may predate this hook.
    i18n.reportError?.({ id, error, pattern, fallback, metadata })

    if (pattern !== fallback) {
      try {
        return renderNodes(parseMessagePattern(fallback), values, components, i18n.locale)
      } catch {
        return [fallback]
      }
    }

    return [fallback]
  }
}

function renderNodes(
  nodes: MessageNode[],
  values: Record<string, unknown>,
  components: Record<string, ReactElement>,
  locale: string,
  pluralValue?: number
): ReactNode[] {
  return nodes.flatMap((node, index) =>
    renderNode(node, values, components, index, locale, pluralValue)
  )
}

function renderNode(
  node: MessageNode,
  values: Record<string, unknown>,
  components: Record<string, ReactElement>,
  key: number,
  locale: string,
  pluralValue?: number
): ReactNode[] {
  switch (node.type) {
    case "text": {
      return [
        pluralValue === undefined
          ? node.value
          : replacePoundPlaceholders(node.value, pluralValue, locale),
      ]
    }
    case "literal": {
      return [node.value]
    }
    case "variable": {
      return [renderVariable(values[node.name], key)]
    }
    case "formatted": {
      return [formatMessagePattern(buildFormattedMessage(node), values, locale)]
    }
    case "tag": {
      const children = renderNodes(node.children, values, components, locale, pluralValue)
      const component = components[node.name]
      if (component && isValidElement(component)) {
        return [cloneElement(component, { key }, ...children)]
      }
      return children
    }
    case "choice": {
      const resolved = resolveChoice(node, values[node.variable], locale)
      const nextPluralValue = node.kind === "select" ? pluralValue : resolved.pluralValue
      return renderNodes(resolved.nodes, values, components, locale, nextPluralValue)
    }
  }
}

function buildFormattedMessage(node: Extract<MessageNode, { type: "formatted" }>): string {
  return `{${node.variable}, ${node.format}${node.style ? `, ${node.style}` : ""}}`
}

function renderVariable(value: unknown, key: number): ReactNode {
  if (isValidElement(value)) {
    return cloneElement(value, { key })
  }

  // Same stringification as the core string renderer (`i18n._`), so Dates
  // render as deterministic ISO strings on server and client alike.
  return stringifyValue(value)
}

export { Fragment }
