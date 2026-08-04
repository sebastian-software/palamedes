import type { JSX } from "solid-js"

import { parseMessagePattern } from "@palamedes/core"
import type { MessageMetadata, MessageNode, PalamedesI18n } from "@palamedes/core"
import { getI18n } from "@palamedes/runtime"

import {
  createSolidMessageRuntime,
  createTrans,
  renderI18nMessage,
  type TransProps,
} from "./transShared"

export {
  buildLocaleSwitchItems,
  type BuildLocaleSwitchItemsOptions,
  type LocaleSwitchItem,
} from "@palamedes/core/locale"

function getActiveI18n(): PalamedesI18n {
  return getI18n<PalamedesI18n>()
}

export type { TransProps } from "./transShared"

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

const RuntimeTrans = createTrans(getActiveI18n, parseMessagePattern)

export function Trans(props: TransProps): JSX.Element {
  return RuntimeTrans(props)
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
    const i18n = getActiveI18n()
    const message = buildChoiceMessage("value", kind, choices, offset)
    const metadata: MessageMetadata = { message, reportMissing: false }
    const runtime = createSolidMessageRuntime(i18n, {}, parseMessagePattern)
    return renderI18nMessage(i18n, message, { value }, runtime, metadata)
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
