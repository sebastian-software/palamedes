import { parseMessagePattern, type MessageNode } from "./messageFormat"

export type ChoiceKind = "plural" | "select" | "selectordinal"

export type ChoiceComponentProps = {
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

/** Metadata consumed by JSX choice transforms rather than rendered as branches. */
export type ChoiceMacroMetadata = {
  context?: string
  comment?: string
}

export type PluralMacroProps = PluralProps & ChoiceMacroMetadata

export type SelectOrdinalMacroProps = SelectOrdinalProps & ChoiceMacroMetadata

export type SelectMacroProps<Props extends SelectProps> = Props &
  ChoiceMacroMetadata & {
    id?: never
    message?: never
  } & Record<Exclude<keyof Props, "value" | "context" | "comment" | "id" | "message">, string>

const PLURAL_CATEGORIES = new Set(["zero", "one", "two", "few", "many", "other"])
const CHOICE_MESSAGE_CACHE_LIMIT = 256
// Choice props may be dynamic, so keep validated patterns in a small FIFO
// instead of letting render-time source text grow a process-wide cache forever.
const choiceMessageCache = new Map<string, string>()

export function buildChoiceMessage(
  variable: string,
  kind: ChoiceKind,
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

  const cacheKey = JSON.stringify([variable, kind, offset, entries])
  const cached = choiceMessageCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const keys = entries.map(([key]) => normalizeChoiceKey(kind, key))
  const parts = entries.map(([key, value], index) => `${keys[index]} {${value}}`)
  const offsetPart = offset === undefined ? "" : ` offset:${offset}`
  const message = `{${variable}, ${kind},${offsetPart} ${parts.join(" ")}}`
  assertParseableChoiceMessage(message, kind, keys)
  if (choiceMessageCache.size >= CHOICE_MESSAGE_CACHE_LIMIT) {
    const oldestKey = choiceMessageCache.keys().next().value
    if (oldestKey !== undefined) {
      choiceMessageCache.delete(oldestKey)
    }
  }
  choiceMessageCache.set(cacheKey, message)
  return message
}

function normalizeChoiceKey(kind: ChoiceKind, key: string): string {
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

function assertParseableChoiceMessage(
  message: string,
  kind: ChoiceKind,
  expectedKeys: string[]
): void {
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
