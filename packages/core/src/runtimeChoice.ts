import type { MessageChoiceNode, MessageNode } from "./messageFormat"
import { requireChoiceNumericValue, selectPluralCategory } from "./runtimeFormat"

export type ResolvedChoice = {
  nodes: MessageNode[]
  /** Operand rendered for `#` inside the branch; undefined for `select`. */
  pluralValue?: number
}

/** Shared choice selection for compatibility node renderers. */
export function resolveChoice(
  node: MessageChoiceNode,
  value: unknown,
  locale?: string
): ResolvedChoice {
  if (node.kind === "select") {
    const exact = value == null ? undefined : getChoiceOption(node, String(value))
    return { nodes: exact ?? getChoiceOption(node, "other") ?? [] }
  }

  const numericValue = requireChoiceNumericValue(node.variable, node.kind, value)
  const operand = numericValue - (node.offset ?? 0)
  const exactMatch = getChoiceOption(node, `=${numericValue}`)
  if (exactMatch) {
    return { nodes: exactMatch, pluralValue: operand }
  }

  const category = selectPluralCategory(operand, locale, node.kind)
  return {
    nodes: getChoiceOption(node, category) ?? getChoiceOption(node, "other") ?? [],
    pluralValue: operand,
  }
}

function getChoiceOption(node: MessageChoiceNode, key: string): MessageNode[] | undefined {
  return Object.hasOwn(node.options, key) ? node.options[key] : undefined
}
