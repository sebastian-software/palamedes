/**
 * AST utilities for working with OXC parsed nodes
 */

/**
 * Simple AST walker that visits all nodes
 */
export function walk(
  node: unknown,
  visitors: { enter?: (node: unknown, parent?: unknown) => void | boolean },
  parent?: unknown
): void {
  if (!node || typeof node !== "object") {
    return
  }

  // Call visitor - if it returns true, skip children
  const skip = visitors.enter?.(node, parent)
  if (skip) {
    return
  }

  const record = node as Record<string, unknown>

  for (const key of Object.keys(record)) {
    const child = record[key]

    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === "object" && "type" in item) {
          walk(item, visitors, node)
        }
      }
    } else if (child && typeof child === "object" && "type" in (child as Record<string, unknown>)) {
      walk(child, visitors, node)
    }
  }
}

/**
 * Get string value from an AST node (StringLiteral, Literal, or simple TemplateLiteral)
 */
export function getStringValue(node: unknown): string | undefined {
  if (!node || typeof node !== "object") {
    return undefined
  }

  const record = node as Record<string, unknown>
  const type = record.type

  // StringLiteral (Babel) or Literal (oxc)
  if (type === "StringLiteral" || type === "Literal") {
    const value = record.value
    if (typeof value === "string") {
      return value
    }
  }

  // Simple template literal without expressions
  if (type === "TemplateLiteral") {
    const quasis = record.quasis as Array<Record<string, unknown>> | undefined
    const expressions = record.expressions as unknown[] | undefined

    if (quasis?.length === 1 && (!expressions || expressions.length === 0)) {
      const quasi = quasis[0]
      if (quasi) {
        const quasiValue = quasi.value as Record<string, unknown> | undefined
        return (quasiValue?.cooked as string) ?? (quasiValue?.raw as string)
      }
    }
  }

  return undefined
}

/**
 * Extract properties from an ObjectExpression as a string map
 */
export function extractObjectProperties(obj: unknown): Record<string, string | undefined> {
  const props: Record<string, string | undefined> = {}

  if (!obj || typeof obj !== "object") {
    return props
  }

  const record = obj as Record<string, unknown>
  const properties = record.properties as Array<Record<string, unknown>> | undefined

  if (!properties) {
    return props
  }

  for (const prop of properties) {
    // Handle both "Property" (oxc) and "ObjectProperty" (Babel)
    if (prop.type === "Property" || prop.type === "ObjectProperty") {
      const key = prop.key as Record<string, unknown> | undefined
      const keyName = (key?.name as string) ?? (key?.value as string)
      const value = getStringValue(prop.value)

      if (keyName) {
        props[keyName] = value
      }
    }
  }

  return props
}

/**
 * Helper to calculate line number from byte offset
 */
export function createLineLocator(code: string): (offset: number) => number {
  const lineStarts: number[] = [0]

  for (let i = 0; i < code.length; i++) {
    if (code[i] === "\n") {
      lineStarts.push(i + 1)
    }
  }

  return function getLine(offset: number): number {
    let low = 0
    let high = lineStarts.length - 1

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2)
      const midValue = lineStarts[mid]
      if (midValue !== undefined && midValue <= offset) {
        low = mid
      } else {
        high = mid - 1
      }
    }

    return low + 1 // 1-indexed
  }
}
