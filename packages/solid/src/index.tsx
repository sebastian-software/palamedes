import type { JSX } from "solid-js"

import { formatMessagePattern } from "@palamedes/core"
import type { MessageChoiceNode, MessageNode, PalamedesI18n } from "@palamedes/core"

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
}

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
    const nodes = i18n.getMessageNodes(resolvedId, {
      message,
      context,
      comment,
    })

    return renderNodes(nodes, values ?? {}, components ?? {}, i18n.locale)
  }) as unknown as JSX.Element
}

export function Plural({ value, offset, ...choices }: PluralProps): JSX.Element {
  return (() => {
    const i18n = useReactiveI18n()
    const message = buildChoiceMessage("value", "plural", choices, offset)
    return formatMessagePattern(message, { value }, i18n.locale)
  }) as unknown as JSX.Element
}

export function SelectOrdinal({ value, offset, ...choices }: SelectOrdinalProps): JSX.Element {
  return (() => {
    const i18n = useReactiveI18n()
    const message = buildChoiceMessage("value", "selectordinal", choices, offset)
    return formatMessagePattern(message, { value }, i18n.locale)
  }) as unknown as JSX.Element
}

export function Select({ value, ...choices }: SelectProps): JSX.Element {
  return (() => {
    const i18n = useReactiveI18n()
    const message = buildChoiceMessage("value", "select", choices)
    return formatMessagePattern(message, { value }, i18n.locale)
  }) as unknown as JSX.Element
}

function buildChoiceMessage(
  variable: string,
  kind: "plural" | "select" | "selectordinal",
  choices: Record<string, string | number | undefined>,
  offset?: number
): string {
  validatePluralOffset(offset)
  const parts = Object.entries(choices)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key} {${value}}`)
  const offsetPart = offset === undefined ? "" : ` offset:${offset}`
  return `{${variable}, ${kind},${offsetPart} ${parts.join(" ")}}`
}

function validatePluralOffset(offset: number | undefined): void {
  if (offset !== undefined && (!Number.isSafeInteger(offset) || offset < 0)) {
    throw new RangeError("Plural offset must be a non-negative safe integer.")
  }
}

function renderNodes(
  nodes: MessageNode[],
  values: Record<string, unknown>,
  components: Record<string, WrapperComponent | JSX.Element>,
  locale: string,
  pluralValue?: number
): JSX.Element[] {
  return nodes.flatMap((node, index) =>
    renderNode(node, values, components, index, locale, pluralValue)
  )
}

function renderNode(
  node: MessageNode,
  values: Record<string, unknown>,
  components: Record<string, WrapperComponent | JSX.Element>,
  key: number,
  locale: string,
  pluralValue?: number
): JSX.Element[] {
  switch (node.type) {
    case "text": {
      return [
        pluralValue === undefined
          ? node.value
          : node.value.replaceAll("#", formatNumber(pluralValue, locale)),
      ]
    }
    case "literal": {
      return [node.value]
    }
    case "variable": {
      return [renderVariable(values[node.name])]
    }
    case "formatted": {
      return [formatMessagePattern(buildFormattedMessage(node), values, locale)]
    }
    case "tag": {
      const children = renderNodes(node.children, values, components, locale, pluralValue)
      const component = components[node.name]

      if (typeof component === "function") {
        return [component(children as unknown as JSX.Element)]
      }

      if (component !== undefined && component !== null) {
        return [component as JSX.Element]
      }

      return children
    }
    case "choice": {
      const value = values[node.variable]
      const nextPluralValue =
        node.kind === "select" ? pluralValue : pluralOperand(node, normalizeNumericValue(value))
      const choice = selectChoice(node, value, locale)
      return renderNodes(choice, values, components, locale, nextPluralValue)
    }
  }

  return []
}

function buildFormattedMessage(node: Extract<MessageNode, { type: "formatted" }>): string {
  return `{${node.variable}, ${node.format}${node.style ? `, ${node.style}` : ""}}`
}

function selectChoice(node: MessageChoiceNode, value: unknown, locale: string): MessageNode[] {
  if (node.kind === "select") {
    const exact = value == null ? undefined : node.options[String(value)]
    return exact ?? node.options.other ?? []
  }

  const numericValue = normalizeNumericValue(value)
  const exactKey = `=${numericValue}`
  if (node.options[exactKey]) {
    return node.options[exactKey]
  }

  const operand = pluralOperand(node, numericValue)
  const pluralRules = new Intl.PluralRules(locale, {
    type: node.kind === "selectordinal" ? "ordinal" : "cardinal",
  })
  const category = pluralRules.select(operand)
  return node.options[category] ?? node.options.other ?? []
}

function pluralOperand(node: MessageChoiceNode, numericValue: number): number {
  return numericValue - (node.offset ?? 0)
}

function renderVariable(value: unknown): JSX.Element {
  if (value === null || value === undefined) {
    return ""
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }

  return value as JSX.Element
}

function normalizeNumericValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatNumber(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value)
}
