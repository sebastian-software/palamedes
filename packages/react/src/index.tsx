import * as React from "react"
import { cloneElement, Fragment, isValidElement } from "react"
import type { ReactElement, ReactNode } from "react"

import { getI18n } from "@palamedes/runtime"
import { formatMessagePattern, parseMessagePattern } from "@palamedes/core"
import type { MessageChoiceNode, MessageNode, PalamedesI18n } from "@palamedes/core"

export {
  buildLocaleSwitchItems,
  type BuildLocaleSwitchItemsOptions,
  type LocaleSwitchItem,
} from "@palamedes/core/locale"

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
}

export type PluralProps = {} & ChoiceComponentProps

export type SelectOrdinalProps = {} & ChoiceComponentProps

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
}: TransProps): ReactNode {
  const i18n = getI18n<PalamedesI18n>()
  const resolvedId = id ?? message ?? ""
  const pattern = i18n.getMessage(resolvedId, {
    message,
    context,
    comment,
  })
  return (
    <>{renderNodes(parseMessagePattern(pattern), values ?? {}, components ?? {}, i18n.locale)}</>
  )
}

export function Plural({ value, ...choices }: PluralProps): ReactNode {
  const i18n = getI18n<PalamedesI18n>()
  const message = buildChoiceMessage("value", "plural", choices)
  return <>{formatMessagePattern(message, { value }, i18n.locale)}</>
}

export function SelectOrdinal({ value, ...choices }: SelectOrdinalProps): ReactNode {
  const i18n = getI18n<PalamedesI18n>()
  const message = buildChoiceMessage("value", "selectordinal", choices)
  return <>{formatMessagePattern(message, { value }, i18n.locale)}</>
}

export function Select({ value, ...choices }: SelectProps): ReactNode {
  const i18n = getI18n<PalamedesI18n>()
  const message = buildChoiceMessage("value", "select", choices)
  return <>{formatMessagePattern(message, { value }, i18n.locale)}</>
}

function buildChoiceMessage(
  variable: string,
  kind: "plural" | "select" | "selectordinal",
  choices: Record<string, string | number | undefined>
): string {
  const parts = Object.entries(choices)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, value]) => `${key} {${value}}`)
  return `{${variable}, ${kind}, ${parts.join(" ")}}`
}

function renderNodes(
  nodes: MessageNode[],
  values: Record<string, unknown>,
  components: Record<string, ReactElement>,
  locale?: string,
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
  locale?: string,
  pluralValue?: number
): ReactNode[] {
  switch (node.type) {
    case "text": {
      return [
        pluralValue === undefined
          ? node.value
          : node.value.replaceAll("#", formatNumber(pluralValue, locale)),
      ]
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
      if (component && isValidElement(component)) {
        return [cloneElement(component, { key }, ...children)]
      }
      return children
    }
    case "choice": {
      const value = values[node.variable]
      const nextPluralValue = node.kind === "select" ? pluralValue : normalizeNumericValue(value)
      const choice = selectChoice(node, value, locale)
      return renderNodes(choice, values, components, locale, nextPluralValue)
    }
  }

  return []
}

function buildFormattedMessage(node: Extract<MessageNode, { type: "formatted" }>): string {
  return `{${node.variable}, ${node.format}${node.style ? `, ${node.style}` : ""}}`
}

function selectChoice(node: MessageChoiceNode, value: unknown, locale?: string): MessageNode[] {
  if (node.kind === "select") {
    const exact = value == null ? undefined : node.options[String(value)]
    return exact ?? node.options.other ?? []
  }

  const numericValue = normalizeNumericValue(value)
  const exactKey = `=${numericValue}`
  if (node.options[exactKey]) {
    return node.options[exactKey]
  }

  const pluralRules = new Intl.PluralRules(locale, {
    type: node.kind === "selectordinal" ? "ordinal" : "cardinal",
  })
  const category = pluralRules.select(numericValue)
  return node.options[category] ?? node.options.other ?? []
}

function renderVariable(value: unknown): ReactNode {
  if (value === null || value === undefined) {
    return ""
  }

  if (isValidElement(value)) {
    return cloneElement(value, {})
  }

  return String(value)
}

function normalizeNumericValue(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function formatNumber(value: number, locale?: string): string {
  return new Intl.NumberFormat(locale).format(value)
}

export { Fragment }
