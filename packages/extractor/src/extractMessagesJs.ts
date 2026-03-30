/**
 * Core message extraction logic using oxc AST
 */

/**
 * Helper to calculate line number from byte offset
 */
function createLineLocator(code: string) {
  const lineStarts: number[] = [0]

  for (let i = 0; i < code.length; i++) {
    if (code[i] === "\n") {
      lineStarts.push(i + 1)
    }
  }

  return function getLine(offset: number): number {
    // Binary search for the line
    let low = 0
    let high = lineStarts.length - 1

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2)
      if (lineStarts[mid] <= offset) {
        low = mid
      } else {
        high = mid - 1
      }
    }

    return low + 1 // 1-indexed
  }
}

// Palamedes macro package names
const PALAMEDES_MACRO_PACKAGES = [
  "@palamedes/core/macro",
  "@palamedes/react/macro",
  "@palamedes/solid/macro",
] as const

// JSX macro names
const JSX_MACROS = ["Trans", "Plural", "Select", "SelectOrdinal"] as const

// JS macro names
const JS_MACROS = ["t", "msg", "defineMessage", "plural", "select", "selectOrdinal"] as const

export interface ExtractedMessageInfo {
  message: string
  comment?: string
  context?: string
  placeholders?: Record<string, string>
  origin: [filename: string, line: number, column?: number]
}

interface ImportedMacro {
  localName: string
  importedName: string
  source: string
}

/**
 * Simple AST walker
 */
function walk(node: any, visitors: { enter?: (node: any, parent?: any) => void }, parent?: any) {
  if (!node || typeof node !== "object") return

  visitors.enter?.(node, parent)

  for (const key of Object.keys(node)) {
    const child = node[key]
    if (Array.isArray(child)) {
      child.forEach((c) => walk(c, visitors, node))
    } else if (child && typeof child === "object" && child.type) {
      walk(child, visitors, node)
    }
  }
}

/**
 * Extract messages from an oxc AST
 *
 * @param program - The parsed AST from oxc-parser
 * @param filename - The source filename
 * @param code - Optional source code for accurate line numbers
 */
export function extractMessages(
  program: any,
  filename: string,
  code?: string
): ExtractedMessageInfo[] {
  const messages: ExtractedMessageInfo[] = []
  const importedMacros = new Map<string, ImportedMacro>()
  const getLine = code ? createLineLocator(code) : () => 0

  // First pass: collect imports from Palamedes macro packages
  walk(program, {
    enter(node) {
      if (node.type === "ImportDeclaration") {
        const source = node.source?.value
        if (!PALAMEDES_MACRO_PACKAGES.some(pkg => source === pkg)) {
          return
        }

        for (const specifier of node.specifiers || []) {
          if (specifier.type === "ImportSpecifier") {
            const importedName = specifier.imported?.name || specifier.local?.name
            const localName = specifier.local?.name
            if (importedName && localName) {
              importedMacros.set(localName, {
                localName,
                importedName,
                source,
              })
            }
          }
        }
      }
    },
  })

  // Note: We don't skip extraction if there are no macro imports,
  // because we also want to extract i18n._() runtime calls which don't require imports

  // Helper to check if an identifier is a Palamedes macro from a direct import.
  function isPalamedesMacro(name: string, expectedMacros: readonly string[]): ImportedMacro | undefined {
    const macro = importedMacros.get(name)
    if (macro && expectedMacros.includes(macro.importedName as any)) {
      return macro
    }
    return undefined
  }

  // Second pass: extract messages
  walk(program, {
    enter(node) {
      // JSX Elements: <Trans>, <Plural>, <Select>, <SelectOrdinal>
      if (node.type === "JSXElement") {
        const openingElement = node.openingElement
        const tagName = openingElement?.name?.name

        const macro = isPalamedesMacro(tagName, JSX_MACROS)
        if (!macro) return

          const extracted = extractFromJSXElement(node, macro.importedName, filename, getLine)
          if (extracted) {
            messages.push(extracted)
          }
      }

      // Tagged Template: t`...`, msg`...`
      if (node.type === "TaggedTemplateExpression") {
        const tagName = node.tag?.name
        const macro = isPalamedesMacro(tagName, JS_MACROS)

        if (macro && (macro.importedName === "t" || macro.importedName === "msg")) {
          const extracted = extractFromTaggedTemplate(node, filename, getLine)
          if (extracted) {
            messages.push(extracted)
          }
        }
      }

      // Call Expression: t({...}), defineMessage({...}), plural(...), select(...)
      if (node.type === "CallExpression") {
        let calleeName: string | undefined

        // Direct call: t({...})
        if (node.callee?.type === "Identifier") {
          calleeName = node.callee.name
        }

        if (calleeName) {
          const macro = isPalamedesMacro(calleeName, JS_MACROS)

          if (macro) {
          const extracted = extractFromCallExpression(node, macro.importedName, filename, getLine)
          if (extracted) {
            messages.push(extracted)
          }
          }
        }

        // Runtime call: i18n._("id") or i18n._({...}) or obj.i18n._("id")
        if (isI18nRuntimeCall(node.callee)) {
          const extracted = extractFromI18nRuntimeCall(node, filename, getLine)
          if (extracted) {
            messages.push(extracted)
          }
        }
      }

      // Runtime tagged template: i18n.t`Hello`
      if (node.type === "TaggedTemplateExpression") {
        // Check for i18n.t`...`
        if (isI18nRuntimeCall(node.tag, true)) {
          const extracted = extractFromRuntimeTaggedTemplate(node, filename, getLine)
          if (extracted) {
            messages.push(extracted)
          }
        }
      }
    },
  })

  return messages
}

export { extractMessages as extractMessagesJs }

/**
 * Extract message from JSX element like <Trans>, <Plural>, etc.
 */
function extractFromJSXElement(
  node: any,
  macroName: string,
  filename: string,
  getLine: (offset: number) => number
): ExtractedMessageInfo | null {
  const attrs = getJSXAttributes(node.openingElement)
  const line = getLine(node.start || 0)
  const column = undefined // Column calculation would be expensive

  if (macroName === "Trans") {
    if (attrs.id) {
      throw new Error(unsupportedExplicitIdMessage())
    }

    const message = attrs.message || extractJSXChildrenAsMessage(node.children)
    const comment = attrs.comment
    const context = attrs.context

    if (!message) return null

    return {
      message,
      comment,
      context,
      origin: [filename, line, column],
    }
  }

  if (macroName === "Plural" || macroName === "Select" || macroName === "SelectOrdinal") {
    if (attrs.id) {
      throw new Error(unsupportedExplicitIdMessage())
    }

    const format = macroName.toLowerCase()
    const valueName = extractValueName(node.openingElement)
    const options = extractChoiceOptions(attrs)

    if (!valueName || Object.keys(options).length === 0) return null

    const message = buildICUMessage(format, valueName, options, attrs.offset)
    const context = attrs.context

    return {
      message,
      comment: attrs.comment,
      context,
      origin: [filename, line, column],
    }
  }

  return null
}

/**
 * Extract message from macro tagged template like t`Hello ${name}`
 * This generates a hash ID for the message (same as Babel macro plugin)
 */
function extractFromTaggedTemplate(
  node: any,
  filename: string,
  getLine: (offset: number) => number
): ExtractedMessageInfo | null {
  const quasi = node.quasi
  if (!quasi) return null

  const line = getLine(node.start || 0)
  const column = undefined

  const { message, placeholders } = extractFromTemplateLiteral(quasi)

  if (!message) return null

  return {
    message,
    placeholders,
    origin: [filename, line, column],
  }
}

/**
 * Extract message from runtime tagged template like i18n.t`Hello ${name}`
 * This uses the message itself as ID (no hash generation)
 */
function extractFromRuntimeTaggedTemplate(
  node: any,
  filename: string,
  getLine: (offset: number) => number
): ExtractedMessageInfo | null {
  const quasi = node.quasi
  if (!quasi) return null

  const line = getLine(node.start || 0)
  const column = undefined

  const { message, placeholders } = extractFromTemplateLiteral(quasi)

  if (!message) return null

  return {
    message,
    placeholders,
    origin: [filename, line, column],
  }
}

/**
 * Extract message from call expression like t({...}), defineMessage({...})
 */
function extractFromCallExpression(
  node: any,
  macroName: string,
  filename: string,
  getLine: (offset: number) => number
): ExtractedMessageInfo | null {
  const args = node.arguments || []
  const line = getLine(node.start || 0)
  const column = undefined

  if (macroName === "t" || macroName === "defineMessage" || macroName === "msg") {
    const firstArg = args[0]

    if (firstArg?.type === "ObjectExpression") {
      const props = extractObjectProperties(firstArg)

      if (props.id) {
        throw new Error(unsupportedExplicitIdMessage())
      }
      const message = props.message
      const comment = props.comment
      const context = props.context

      if (!message) return null

      return {
        message,
        comment,
        context,
        origin: [filename, line, column],
      }
    }
  }

  if (macroName === "plural" || macroName === "select" || macroName === "selectOrdinal") {
    // plural(count, { one: "# item", other: "# items" })
    const valueArg = args[0]
    const optionsArg = args[1]

    if (!valueArg || optionsArg?.type !== "ObjectExpression") return null

    const valueName = extractExpressionName(valueArg)
    const options = extractChoiceOptionsFromObject(optionsArg)
    const format = macroName === "selectOrdinal" ? "selectordinal" : macroName

    if (!valueName || Object.keys(options).length === 0) return null

    const message = buildICUMessage(format, valueName, options)

    return {
      message,
      origin: [filename, line, column],
    }
  }

  return null
}

/**
 * Get attributes from JSX opening element as key-value pairs
 */
function getJSXAttributes(openingElement: any): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {}

  for (const attr of openingElement?.attributes || []) {
    if (attr.type === "JSXAttribute" && attr.name?.type === "JSXIdentifier") {
      const name = attr.name.name
      const value = getJSXAttributeValue(attr.value)
      result[name] = value
    }
  }

  return result
}

/**
 * Get string value from JSX attribute value
 */
function getJSXAttributeValue(valueNode: any): string | undefined {
  if (!valueNode) return undefined

  // oxc uses "Literal" for string literals
  if (valueNode.type === "StringLiteral" || valueNode.type === "Literal") {
    return valueNode.value
  }

  if (valueNode.type === "JSXExpressionContainer") {
    const expr = valueNode.expression
    if (expr?.type === "StringLiteral" || expr?.type === "Literal") {
      return expr.value
    }
    if (expr?.type === "TemplateLiteral" && expr.quasis?.length === 1) {
      return expr.quasis[0].value?.cooked || expr.quasis[0].value?.raw
    }
  }

  return undefined
}

/**
 * Extract text content from JSX children, converting expressions to placeholders
 */
function extractJSXChildrenAsMessage(children: any[]): string {
  if (!children) return ""

  let placeholderIndex = 0
  const parts: string[] = []

  for (const child of children) {
    if (child.type === "JSXText") {
      const text = cleanJSXText(child.value)
      if (text) parts.push(text)
    } else if (child.type === "JSXExpressionContainer") {
      const expr = child.expression
      if (expr?.type === "StringLiteral") {
        parts.push(expr.value)
      } else if (expr?.type === "Identifier") {
        parts.push(`{${expr.name}}`)
      } else {
        parts.push(`{${placeholderIndex++}}`)
      }
    } else if (child.type === "JSXElement") {
      // Nested element: <Trans>Hello <b>world</b></Trans> → "Hello <0>world</0>"
      const innerText = extractJSXChildrenAsMessage(child.children)
      parts.push(`<${placeholderIndex}>${innerText}</${placeholderIndex}>`)
      placeholderIndex++
    }
  }

  return parts.join("").trim()
}

/**
 * Clean JSX text (remove extra whitespace)
 */
function cleanJSXText(text: string): string {
  // Replace newlines and multiple spaces with single space
  return text.replace(/\s+/g, " ")
}

/**
 * Extract the value name from a JSX element (for Plural/Select)
 */
function extractValueName(openingElement: any): string | undefined {
  for (const attr of openingElement?.attributes || []) {
    if (attr.type === "JSXAttribute" && attr.name?.name === "value") {
      const value = attr.value
      if (value?.type === "JSXExpressionContainer") {
        return extractExpressionName(value.expression)
      }
    }
  }
  return undefined
}

/**
 * Extract a meaningful name from an expression for use as placeholder.
 * Tries to extract something readable before falling back to numeric index.
 *
 * - Identifier: `userName` → "userName"
 * - MemberExpression: `user.name` → "name"
 * - Computed property with string: `user["role"]` → "role"
 * - Getter call: `getUser()` → "user", `getUserName()` → "userName"
 * - Everything else: undefined → caller uses numeric index
 */
function extractExpressionName(expr: any): string | undefined {
  if (!expr) return undefined

  // Simple identifier: userName → "userName"
  if (expr.type === "Identifier") {
    return expr.name
  }

  // Member expression: user.name → "name", user["role"] → "role"
  if (expr.type === "MemberExpression") {
    const property = expr.property
    if (property?.type === "Identifier" && !expr.computed) {
      // user.name → "name"
      return property.name
    }
    if (expr.computed && property?.type === "StringLiteral") {
      // user["role"] → "role"
      return property.value
    }
    if (expr.computed && property?.type === "Literal" && typeof property.value === "string") {
      // user["role"] → "role" (oxc sometimes uses Literal instead of StringLiteral)
      return property.value
    }
    // user[0] or user[someVar] → undefined (will become numeric index)
  }

  // Call expression: getUser() → "user", getUserName() → "userName"
  if (expr.type === "CallExpression") {
    const callee = expr.callee
    let funcName: string | undefined

    if (callee?.type === "Identifier") {
      funcName = callee.name
    } else if (callee?.type === "MemberExpression" && callee.property?.type === "Identifier") {
      // obj.getUser() → use "getUser"
      funcName = callee.property.name
    }

    if (funcName) {
      const extracted = extractNameFromGetter(funcName)
      if (extracted) return extracted
    }
  }

  // BinaryExpression, ConditionalExpression, etc.
  // → undefined (will become numeric index)
  return undefined
}

/**
 * Extract a name from a getter function name.
 * getUser → "user", getUserName → "userName", get → undefined
 */
function extractNameFromGetter(funcName: string): string | undefined {
  if (funcName.startsWith("get") && funcName.length > 3) {
    // getUser → User → user
    // getUserName → UserName → userName
    const rest = funcName.slice(3)
    // Check if it's actually PascalCase (starts with uppercase)
    if (rest[0] === rest[0].toUpperCase()) {
      return rest[0].toLowerCase() + rest.slice(1)
    }
  }
  return undefined
}

/**
 * Extract choice options from JSX attributes (for Plural/Select)
 */
function extractChoiceOptions(attrs: Record<string, string | undefined>): Record<string, string> {
  const options: Record<string, string> = {}
  // Reserved attribute names that are not choice options
  const reservedKeys = ["id", "message", "comment", "context", "value", "offset"]

  for (const [key, value] of Object.entries(attrs)) {
    if (reservedKeys.includes(key) || value === undefined) {
      continue
    }

    // Handle _0, _1, etc. for exact matches
    if (key.startsWith("_")) {
      const exactKey = "=" + key.slice(1)
      options[exactKey] = value
    } else {
      // All other keys are choice options (one, other, male, female, etc.)
      options[key] = value
    }
  }

  return options
}

/**
 * Extract choice options from object expression
 */
function extractChoiceOptionsFromObject(obj: any): Record<string, string> {
  const options: Record<string, string> = {}

  for (const prop of obj?.properties || []) {
    // oxc uses "Property", Babel uses "ObjectProperty"
    if (prop.type === "ObjectProperty" || prop.type === "Property") {
      const key = prop.key?.name || prop.key?.value
      const value = getStringValue(prop.value)

      if (key && value !== undefined) {
        // Handle _0, _1 etc.
        if (typeof key === "string" && key.startsWith("_")) {
          options["=" + key.slice(1)] = value
        } else {
          options[key] = value
        }
      }
    }
  }

  return options
}

/**
 * Extract properties from object expression
 */
function extractObjectProperties(obj: any): Record<string, string | undefined> {
  const props: Record<string, string | undefined> = {}

  for (const prop of obj?.properties || []) {
    // oxc uses "Property", Babel uses "ObjectProperty"
    if (prop.type === "ObjectProperty" || prop.type === "Property") {
      const key = prop.key?.name || prop.key?.value
      const value = getStringValue(prop.value)
      if (key) {
        props[key] = value
      }
    }
  }

  return props
}

/**
 * Get string value from AST node
 */
function getStringValue(node: any): string | undefined {
  // oxc uses "Literal", Babel uses "StringLiteral"
  if (node?.type === "StringLiteral" || node?.type === "Literal") {
    return node.value
  }
  if (node?.type === "TemplateLiteral" && node.quasis?.length === 1) {
    return node.quasis[0].value?.cooked || node.quasis[0].value?.raw
  }
  return undefined
}

/**
 * Extract message and placeholders from template literal
 */
function extractFromTemplateLiteral(quasi: any): {
  message: string
  placeholders: Record<string, string>
} {
  const parts: string[] = []
  const placeholders: Record<string, string> = {}
  const quasis = quasi.quasis || []
  const expressions = quasi.expressions || []

  for (let i = 0; i < quasis.length; i++) {
    const text = quasis[i].value?.cooked || quasis[i].value?.raw || ""
    parts.push(text)

    if (i < expressions.length) {
      const expr = expressions[i]
      const name = extractExpressionName(expr) || String(i)
      parts.push(`{${name}}`)
      // Store the original expression as placeholder
      placeholders[name] = name
    }
  }

  return {
    message: parts.join(""),
    placeholders,
  }
}

/**
 * Build ICU message format string for plural/select
 */
function buildICUMessage(
  format: string,
  valueName: string,
  options: Record<string, string>,
  offset?: string
): string {
  const optionParts = Object.entries(options)
    .map(([key, value]) => `${key} {${value}}`)
    .join(" ")

  const offsetPart = offset ? ` offset:${offset}` : ""

  return `{${valueName}, ${format},${offsetPart} ${optionParts}}`
}

/**
 * Check if a node is an i18n runtime call pattern:
 * - i18n._(...) or i18n.t`...`
 * - obj.i18n._(...) or obj.i18n.t`...`
 *
 * @param allowT - if true, also match i18n.t (for tagged templates)
 */
function isI18nRuntimeCall(node: any, allowT = false): boolean {
  if (node?.type !== "MemberExpression") return false

  const property = node.property
  const propertyName = property?.name

  // Check if property is _ or t
  if (propertyName !== "_" && !(allowT && propertyName === "t")) {
    return false
  }

  const object = node.object

  // Direct: i18n._() or i18n.t``
  if (object?.type === "Identifier" && object.name === "i18n") {
    return true
  }

  // Nested: this.i18n._() or obj.i18n._()
  if (
    object?.type === "MemberExpression" &&
    object.property?.type === "Identifier" &&
    object.property.name === "i18n"
  ) {
    return true
  }

  return false
}

/**
 * Extract message from i18n runtime call:
 * - i18n._("Hello")
 * - i18n._({ message: "Hello" })
 * - i18n._("hash", values, { message: "Hello" }) for transformed code
 */
function extractFromI18nRuntimeCall(
  node: any,
  filename: string,
  getLine: (offset: number) => number
): ExtractedMessageInfo | null {
  const args = node.arguments || []
  const line = getLine(node.start || 0)

  if (args.length === 0) return null

  const firstArg = args[0]

  if (firstArg?.type === "ObjectExpression") {
    const props = extractObjectProperties(firstArg)

    if (props.id) {
      throw new Error(unsupportedExplicitIdMessage())
    }
    if (!props.message) return null

    return {
      message: props.message,
      comment: props.comment,
      context: props.context,
      origin: [filename, line, undefined],
    }
  }

  const firstValue = getStringValue(firstArg)
  if (!firstValue) return null

  let message: string | undefined = firstValue
  let comment: string | undefined
  let context: string | undefined

  const thirdArg = args[2]
  if (thirdArg?.type === "ObjectExpression") {
    const props = extractObjectProperties(thirdArg)
    if (props.id) {
      throw new Error(unsupportedExplicitIdMessage())
    }
    message = props.message || message
    comment = props.comment
    context = props.context
  }

  if (!message) return null

  return {
    message,
    comment,
    context,
    origin: [filename, line, undefined],
  }
}

function unsupportedExplicitIdMessage(): string {
  return "Explicit message ids are no longer supported. Remove `id` and rely on message/context instead."
}
