/**
 * Core transform logic for Lingui macros using OXC
 */

import { generateMessageId } from "@palamedes/core-node"
import oxc from "oxc-parser"
import MagicString from "magic-string"
import type { TransformOptions, TransformResult, SourceMap } from "./types"
import { LINGUI_MACRO_PACKAGES } from "./types"
import { walk, extractObjectProperties } from "./ast"
import { mightContainLinguiMacros, findMacroImports } from "./detect"

/**
 * Parse code using oxc-parser
 */
function parseCode(code: string, filename: string): { program: unknown } {
  const result = oxc.parseSync(filename, code, {
    sourceType: "module",
  })

  if (result.errors.length > 0) {
    const errorMessages = result.errors.map((e) => e.message).join(", ")
    throw new Error(`Parse error in ${filename}: ${errorMessages}`)
  }

  return result
}

interface Replacement {
  start: number
  end: number
  text: string
  needsTransImport?: boolean
}

interface ImportInfo {
  localName: string
  importedName: string
  source: string
}

/**
 * Main transform function - transforms Lingui macros to runtime calls
 */
export function transformLinguiMacros(
  code: string,
  filename: string,
  options: TransformOptions = {}
): TransformResult {
  // Quick pre-check: if no macro imports, return early
  if (!mightContainLinguiMacros(code)) {
    return { code, hasChanged: false, map: null }
  }

  const { program } = parseCode(code, filename)

  // Find all macro imports
  const macroImports = findMacroImports(program)

  if (macroImports.size === 0) {
    return { code, hasChanged: false, map: null }
  }

  const runtimeModule = getRuntimeModule(options)
  const runtimeImportName = getRuntimeImportName(options)

  // Collect all replacements
  const replacements: Replacement[] = []
  const importsToRemove: Array<{ start: number; end: number }> = []
  let needsRuntimeImport = false

  // Track which imports to remove
  const importDeclarationsToRemove = new Set<unknown>()

  // Track useLingui/getLingui destructured variables: { t: "_", plural: "_" }
  // Maps local variable name to the function it provides
  const useLinguiBindings = new Map<string, "t" | "plural" | "select" | "selectOrdinal">()
  // Track getLingui bindings separately (these use i18n._ instead of hook's _)
  const getLinguiBindings = new Map<string, "t" | "plural" | "select" | "selectOrdinal">()

  // Walk the AST and collect transformations
  walk(program, {
    enter(node) {
      if (!node || typeof node !== "object") {
        return
      }

      const record = node as Record<string, unknown>

      // Track import declarations for removal
      if (record.type === "ImportDeclaration") {
        const source = (record.source as Record<string, unknown>)?.value as string
        if (LINGUI_MACRO_PACKAGES.some((pkg) => source === pkg)) {
          importDeclarationsToRemove.add(node)
          const start = record.start as number
          const end = record.end as number
          importsToRemove.push({ start, end })
        }
        return
      }

      // Track useLingui()/getLingui() in VariableDeclaration: const { t } = useLingui()
      if (record.type === "VariableDeclaration") {
        const declarations = record.declarations as Array<Record<string, unknown>> | undefined
        if (declarations && declarations.length === 1) {
          const declarator = declarations[0]
          const init = declarator?.init as Record<string, unknown> | undefined
          if (init?.type === "CallExpression") {
            const callee = init.callee as Record<string, unknown> | undefined
            const calleeName = callee?.name as string | undefined
            if (calleeName && macroImports.has(calleeName)) {
              const macro = macroImports.get(calleeName)
              const isUseLingui = macro?.importedName === "useLingui"
              const isGetLingui = macro?.importedName === "getLingui"

              if (isUseLingui || isGetLingui) {
                // Parse destructuring pattern: const { t, plural } = useLingui()
                const id = declarator.id as Record<string, unknown> | undefined
                if (id?.type === "ObjectPattern") {
                  const properties = id.properties as Array<Record<string, unknown>> | undefined
                  const targetBindings = isUseLingui ? useLinguiBindings : getLinguiBindings

                  if (properties) {
                    for (const prop of properties) {
                      const key = prop.key as Record<string, unknown> | undefined
                      const value = prop.value as Record<string, unknown> | undefined
                      const keyName = key?.name as string | undefined
                      const valueName = (value?.name ?? keyName) as string | undefined

                      if (keyName && valueName) {
                        // Map: local name -> macro function type
                        if (keyName === "t" || keyName === "_") {
                          targetBindings.set(valueName, "t")
                        } else if (keyName === "plural") {
                          targetBindings.set(valueName, "plural")
                        } else if (keyName === "select") {
                          targetBindings.set(valueName, "select")
                        } else if (keyName === "selectOrdinal") {
                          targetBindings.set(valueName, "selectOrdinal")
                        }
                      }
                    }
                  }

                  const declStart = record.start as number
                  const declEnd = record.end as number
                  replacements.push({
                    start: declStart,
                    end: declEnd,
                    text: "",
                  })
                  needsRuntimeImport = true
                }
              }
            }
          }
        }
      }

      // Transform tagged template expressions: t`Hello`
      if (record.type === "TaggedTemplateExpression") {
        const tag = record.tag as Record<string, unknown> | undefined
        const tagName = tag?.name as string | undefined

        if (tagName) {
          // Check if this is from useLingui() destructuring (uses _)
          const useLinguiBinding = useLinguiBindings.get(tagName)
          if (useLinguiBinding === "t") {
            const replacement = transformTaggedTemplateToRuntimeCall(record, options)
            if (replacement) {
              replacements.push(replacement)
            }
          } else {
            const getLinguiBinding = getLinguiBindings.get(tagName)
            if (getLinguiBinding === "t") {
              const replacement = transformTaggedTemplateToRuntimeCall(record, options)
              if (replacement) {
                replacements.push(replacement)
              }
            } else {
              // Check if from direct macro import
              const macro = macroImports.get(tagName)
              if (macro && (macro.importedName === "t" || macro.importedName === "msg")) {
                const replacement = transformTaggedTemplate(record, macro, options)
                if (replacement) {
                  replacements.push(replacement)
                  needsRuntimeImport = true
                }
              }
            }
          }
        }
      }

      // Transform call expressions: t({ id, message }), plural(), select(), selectOrdinal()
      if (record.type === "CallExpression") {
        const callee = record.callee as Record<string, unknown> | undefined
        const calleeName = callee?.name as string | undefined

        if (calleeName) {
          // Check if this is from useLingui() destructuring (uses _)
          const useLinguiBinding = useLinguiBindings.get(calleeName)
          if (useLinguiBinding) {
            if (useLinguiBinding === "plural" || useLinguiBinding === "select" || useLinguiBinding === "selectOrdinal") {
              const replacement = transformPluralSelectCallToRuntimeCall(record, useLinguiBinding, options)
              if (replacement) {
                replacements.push(replacement)
              }
            }
          } else {
            const getLinguiBinding = getLinguiBindings.get(calleeName)
            if (getLinguiBinding) {
              if (getLinguiBinding === "plural" || getLinguiBinding === "select" || getLinguiBinding === "selectOrdinal") {
                const replacement = transformPluralSelectCallToRuntimeCall(record, getLinguiBinding, options)
                if (replacement) {
                  replacements.push(replacement)
                }
              }
            } else {
              // Check if from direct macro import
              const macro = macroImports.get(calleeName)
              if (macro) {
                if (macro.importedName === "t" || macro.importedName === "msg" || macro.importedName === "defineMessage") {
                  const replacement = transformCallExpression(record, macro, options)
                  if (replacement) {
                    replacements.push(replacement)
                    // Only add runtime import for t/msg, not defineMessage
                    if (macro.importedName !== "defineMessage") {
                      needsRuntimeImport = true
                    }
                  }
                } else if (macro.importedName === "plural" || macro.importedName === "select" || macro.importedName === "selectOrdinal") {
                  const replacement = transformPluralSelectCall(record, macro, options)
                  if (replacement) {
                    replacements.push(replacement)
                    needsRuntimeImport = true
                  }
                }
              }
            }
          }
        }
      }

      // Transform JSX elements: <Trans>, <Plural>, <Select>, <SelectOrdinal>
      if (record.type === "JSXElement") {
        const openingElement = record.openingElement as Record<string, unknown> | undefined
        const elementName = openingElement?.name as Record<string, unknown> | undefined
        const tagName = elementName?.name as string | undefined

        if (tagName) {
          const macro = macroImports.get(tagName)
          if (macro) {
            if (macro.importedName === "Trans") {
              const replacement = transformTransComponent(record, macro, options, code)
              if (replacement) {
                replacements.push(replacement)
                needsRuntimeImport = true
              }
            } else if (macro.importedName === "Plural" || macro.importedName === "Select" || macro.importedName === "SelectOrdinal") {
              const replacement = transformPluralSelectComponent(record, macro, options, code)
              if (replacement) {
                replacements.push(replacement)
                needsRuntimeImport = true
              }
            }
          }
        }
      }
    },
  })

  // If no transformations needed, return early
  if (replacements.length === 0 && importsToRemove.length === 0) {
    return { code, hasChanged: false, map: null }
  }

  // Use MagicString for source map support
  const s = new MagicString(code)
  const generateSourceMap = options.sourceMap !== false

  // Apply macro replacements
  for (const replacement of replacements) {
    s.overwrite(replacement.start, replacement.end, replacement.text)
  }

  // Remove macro imports
  for (const importToRemove of importsToRemove) {
    s.remove(importToRemove.start, importToRemove.end)
  }

  // Check if we need Trans component import
  const needsTransImport = replacements.some((r) => r.needsTransImport)

  // Add runtime import if needed (but only if not already present)
  if (needsRuntimeImport) {
    // Check if the runtime import already exists
    const runtimeImportRegex = new RegExp(
      `import\\s*\\{[^}]*\\b${runtimeImportName}\\b[^}]*\\}\\s*from\\s*["']${runtimeModule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`
    )
    const hasRuntimeImport = runtimeImportRegex.test(code)

    if (!hasRuntimeImport) {
      const importStatement = `import { ${runtimeImportName} } from "${runtimeModule}";\n`

      // Find the first import or the start of the file
      const firstImportMatch = code.match(/^import\s/m)
      if (firstImportMatch && firstImportMatch.index !== undefined) {
        s.appendLeft(firstImportMatch.index, importStatement)
      } else {
        s.prepend(importStatement)
      }
    }
  }

  // Add Trans component import if needed
  if (needsTransImport) {
    const transImportRegex = /import\s*\{[^}]*\bTrans\b[^}]*\}\s*from\s*["']@lingui\/react["']/
    const hasTransImport = transImportRegex.test(code)

    if (!hasTransImport) {
      const importStatement = `import { Trans } from "@lingui/react";\n`
      const firstImportMatch = code.match(/^import\s/m)
      if (firstImportMatch && firstImportMatch.index !== undefined) {
        s.appendLeft(firstImportMatch.index, importStatement)
      } else {
        s.prepend(importStatement)
      }
    }
  }

  // Generate result
  let result = s.toString()

  // Clean up empty lines from removed imports
  result = result.replace(/\n\s*\n\s*\n/g, "\n\n")

  // Generate source map if requested
  let map: SourceMap | null = null
  if (generateSourceMap) {
    const generated = s.generateMap({
      source: filename,
      file: filename,
      includeContent: true,
    })
    map = {
      version: generated.version,
      sources: generated.sources,
      sourcesContent: generated.sourcesContent,
      names: generated.names,
      mappings: generated.mappings,
      file: generated.file,
    }
  }

  return { code: result, hasChanged: true, map }
}

export { transformLinguiMacros as transformLinguiMacrosJs }

function getRuntimeModule(options: TransformOptions): string {
  return options.runtimeModule ?? "@palamedes/runtime"
}

function getRuntimeImportName(options: TransformOptions): string {
  return options.runtimeImportName ?? "getI18n"
}

function buildRuntimeCall(descriptor: string, options?: TransformOptions): string {
  return `${getRuntimeImportName(options ?? {})}()._(${descriptor})`
}

/**
 * Transform a tagged template expression: t`Hello ${name}`
 */
function transformTaggedTemplate(
  node: Record<string, unknown>,
  _macro: ImportInfo,
  options: TransformOptions
): Replacement | null {
  const quasi = node.quasi as Record<string, unknown> | undefined
  if (!quasi) {
    return null
  }

  const start = node.start as number
  const end = node.end as number

  // Extract message from template literal
  const { message, values } = extractTemplateLiteral(quasi)
  if (!message) {
    return null
  }

  // Generate message ID
  const id = generateMessageId(message, "")

  const descriptor = buildMessageDescriptor(id, message, values)
  const text = buildRuntimeCall(descriptor, options)

  return { start, end, text }
}

/**
 * Transform a tagged template from a compatibility macro binding.
 */
function transformTaggedTemplateToRuntimeCall(
  node: Record<string, unknown>,
  options: TransformOptions
): Replacement | null {
  const quasi = node.quasi as Record<string, unknown> | undefined
  if (!quasi) {
    return null
  }

  const start = node.start as number
  const end = node.end as number

  const { message, values } = extractTemplateLiteral(quasi)
  const id = generateMessageId(message)

  const descriptor = buildMessageDescriptor(id, message, values)
  const text = buildRuntimeCall(descriptor, options)

  return { start, end, text }
}

/**
 * Transform plural/select/selectOrdinal from a compatibility macro binding.
 */
function transformPluralSelectCallToRuntimeCall(
  node: Record<string, unknown>,
  macroType: "plural" | "select" | "selectOrdinal",
  options: TransformOptions
): Replacement | null {
  const args = node.arguments as Array<Record<string, unknown>> | undefined
  if (!args || args.length < 2) {
    return null
  }

  const start = node.start as number
  const end = node.end as number

  // First arg is the value, second is options
  const valueArg = args[0]
  const optionsArg = args[1]

  // Get the value name (for interpolation)
  const valueName = extractExpressionName(valueArg) ?? "0"

  // Extract options from the second argument
  if (optionsArg?.type !== "ObjectExpression") {
    return null
  }

  const choiceOptions = extractChoiceOptions(optionsArg)
  if (Object.keys(choiceOptions).length === 0) {
    return null
  }

  // Build ICU message format
  const format = macroType === "selectOrdinal" ? "selectordinal" : macroType
  const message = buildICUMessage(format, valueName, choiceOptions)
  const id = generateMessageId(message)

  const descriptor = buildMessageDescriptor(id, message, [valueName])
  const text = buildRuntimeCall(descriptor, options)

  return { start, end, text }
}

/**
 * Transform a call expression: t({ id, message }) or defineMessage({ id, message })
 */
function transformCallExpression(
  node: Record<string, unknown>,
  macro: ImportInfo,
  options: TransformOptions
): Replacement | null {
  const args = node.arguments as Array<Record<string, unknown>> | undefined
  if (!args || args.length === 0) {
    return null
  }

  const firstArg = args[0]
  if (firstArg?.type !== "ObjectExpression") {
    return null
  }

  const start = node.start as number
  const end = node.end as number

  const props = extractObjectProperties(firstArg)
  const explicitId = props.id
  const message = props.message
  const context = props.context
  const comment = props.comment

  if (!explicitId && !message) {
    return null
  }

  // Generate ID if not provided
  const id = explicitId ?? generateMessageId(message!, context)

  // For defineMessage, just return the descriptor object
  if (macro.importedName === "defineMessage") {
    const descriptor = buildMessageDescriptor(id, message, undefined, context, comment, options)
    return { start, end, text: descriptor }
  }

  const descriptor = buildMessageDescriptor(id, message, undefined, context, comment, options)
  const text = buildRuntimeCall(descriptor, options)

  return { start, end, text }
}

/**
 * Extract message and values from a template literal
 */
function extractTemplateLiteral(quasi: Record<string, unknown>): {
  message: string
  values: string[] | undefined
} {
  const quasis = quasi.quasis as Array<Record<string, unknown>> | undefined
  const expressions = quasi.expressions as Array<Record<string, unknown>> | undefined

  if (!quasis) {
    return { message: "", values: undefined }
  }

  const parts: string[] = []
  const values: string[] = []

  for (let i = 0; i < quasis.length; i++) {
    const q = quasis[i]
    if (q) {
      const qValue = q.value as Record<string, unknown> | undefined
      const text = (qValue?.cooked as string) ?? (qValue?.raw as string) ?? ""
      parts.push(text)
    }

    if (expressions && i < expressions.length) {
      const expr = expressions[i]
      if (expr) {
        const name = extractExpressionName(expr) ?? String(i)
        parts.push(`{${name}}`)
        values.push(name)
      }
    }
  }

  return {
    message: parts.join(""),
    values: values.length > 0 ? values : undefined,
  }
}

/**
 * Extract a name from an expression (for use as placeholder name)
 */
function extractExpressionName(expr: Record<string, unknown>): string | undefined {
  // Identifier: name
  if (expr.type === "Identifier") {
    return expr.name as string
  }

  // MemberExpression: obj.prop -> prop
  if (expr.type === "MemberExpression") {
    const property = expr.property as Record<string, unknown> | undefined
    if (property?.type === "Identifier" && !expr.computed) {
      return property.name as string
    }
  }

  return undefined
}

/**
 * Build a message descriptor object as a string
 */
function buildMessageDescriptor(
  id: string,
  message?: string,
  values?: string[],
  context?: string,
  comment?: string,
  options?: TransformOptions
): string {
  const parts: string[] = [`id: "${escapeString(id)}"`]

  if (message && !options?.stripMessageField) {
    parts.push(`message: "${escapeString(message)}"`)
  }

  if (values && values.length > 0) {
    const valuesObj = values.map((v) => `${v}`).join(", ")
    parts.push(`values: { ${valuesObj} }`)
  }

  if (context && !options?.stripNonEssentialProps) {
    parts.push(`context: "${escapeString(context)}"`)
  }

  if (comment && !options?.stripNonEssentialProps) {
    parts.push(`comment: "${escapeString(comment)}"`)
  }

  return `{ ${parts.join(", ")} }`
}

/**
 * Transform plural/select/selectOrdinal call expressions
 * plural(count, { one: "# item", other: "# items" })
 * -> getI18n()._({ id: "...", message: "{count, plural, one {# item} other {# items}}", values: { count } })
 */
function transformPluralSelectCall(
  node: Record<string, unknown>,
  macro: ImportInfo,
  options: TransformOptions
): Replacement | null {
  const args = node.arguments as Array<Record<string, unknown>> | undefined
  if (!args || args.length < 2) {
    return null
  }

  const start = node.start as number
  const end = node.end as number

  // First argument is the value expression
  const valueArg = args[0]
  const valueName = extractExpressionName(valueArg!) ?? "0"

  // Second argument is the options object
  const optionsArg = args[1]
  if (optionsArg?.type !== "ObjectExpression") {
    return null
  }

  const choiceOptions = extractChoiceOptions(optionsArg)
  if (Object.keys(choiceOptions).length === 0) {
    return null
  }

  // Build ICU message format
  const format = macro.importedName === "selectOrdinal" ? "selectordinal" : macro.importedName.toLowerCase()
  const message = buildICUMessage(format, valueName, choiceOptions)

  // Generate ID
  const id = generateMessageId(message, "")

  // Build the replacement
  const descriptor = buildMessageDescriptor(id, message, [valueName], undefined, undefined, options)
  const text = buildRuntimeCall(descriptor, options)

  return { start, end, text }
}

/**
 * Transform <Trans> component to runtime call
 * <Trans>Hello {name}</Trans>
 * -> {getI18n()._({ id: "...", message: "Hello {name}", values: { name } })}
 *
 * Note: We wrap in {...} because Trans is often used as JSX child
 */
function transformTransComponent(
  node: Record<string, unknown>,
  _macro: ImportInfo,
  options: TransformOptions,
  code: string
): Replacement | null {
  const start = node.start as number
  const end = node.end as number

  const openingElement = node.openingElement as Record<string, unknown>
  const attrs = extractJSXAttributes(openingElement)

  // Extract message from children or message prop
  const children = node.children as Array<Record<string, unknown>> | undefined
  const { message, values, components } = attrs.message
    ? { message: attrs.message, values: [] as string[], components: [] as string[] }
    : extractJSXChildrenAsMessage(children || [], code)

  const explicitId = attrs.id
  const context = attrs.context
  const comment = attrs.comment

  if (!message && !explicitId) {
    return null
  }

  // Generate ID if not provided
    const id = explicitId ?? generateMessageId(message, context)

  // Always use the Trans component from @lingui/react
  // This ensures proper reactivity with the I18nProvider context
  const componentsObj = components.length > 0
    ? ` components={{ ${components.map((c, i) => `${i}: ${c}`).join(", ")} }}`
    : ""
  const valuesObj = values.length > 0 ? ` values={{ ${values.join(", ")} }}` : ""

  const text = `<Trans id="${id}" message="${escapeString(message)}"${componentsObj}${valuesObj} />`
  return { start, end, text, needsTransImport: true }
}

/**
 * Transform <Plural>, <Select>, <SelectOrdinal> components
 * <Plural value={count} one="# item" other="# items" />
 * -> {getI18n()._({ id: "...", message: "{count, plural, one {# item} other {# items}}", values: { count } })}
 */
function transformPluralSelectComponent(
  node: Record<string, unknown>,
  macro: ImportInfo,
  options: TransformOptions,
  code: string
): Replacement | null {
  const start = node.start as number
  const end = node.end as number

  const openingElement = node.openingElement as Record<string, unknown>
  const attrs = extractJSXAttributes(openingElement)

  // Get the value from the "value" attribute
  const valueName = attrs._valueName ?? "0"

  // Extract choice options
  const choiceOptions: Record<string, string> = {}
  const reservedKeys = ["id", "message", "comment", "context", "value", "offset", "_valueName"]

  for (const [key, value] of Object.entries(attrs)) {
    if (reservedKeys.includes(key) || value === undefined) {
      continue
    }

    // Handle _0, _1, etc. for exact matches
    if (key.startsWith("_")) {
      const exactKey = "=" + key.slice(1)
      choiceOptions[exactKey] = value
    } else {
      choiceOptions[key] = value
    }
  }

  if (Object.keys(choiceOptions).length === 0) {
    return null
  }

  // Build ICU message format
  const format = macro.importedName === "SelectOrdinal" ? "selectordinal" : macro.importedName.toLowerCase()
  const message = buildICUMessage(format, valueName, choiceOptions, attrs.offset)

  // Generate ID or use explicit
  const explicitId = attrs.id
  const context = attrs.context
  const id = explicitId ?? generateMessageId(message, context)

  // Build the replacement
  const descriptor = buildMessageDescriptor(id, message, [valueName], context, attrs.comment, options)

  // Check if this JSX element is a child of another JSX element
  const beforeStart = code.slice(0, start).trimEnd()
  const isJsxChild = beforeStart.endsWith(">")
  const runtimeCall = buildRuntimeCall(descriptor, options)

  const text = isJsxChild
    ? `{${runtimeCall}}`
    : runtimeCall

  return { start, end, text }
}

/**
 * Extract choice options from an ObjectExpression for plural/select
 */
function extractChoiceOptions(obj: Record<string, unknown>): Record<string, string> {
  const options: Record<string, string> = {}
  const properties = obj.properties as Array<Record<string, unknown>> | undefined

  if (!properties) {
    return options
  }

  for (const prop of properties) {
    if (prop.type === "Property" || prop.type === "ObjectProperty") {
      const key = prop.key as Record<string, unknown> | undefined
      const keyName = (key?.name as string) ?? (key?.value as string)
      const value = getStringValue(prop.value as Record<string, unknown>)

      if (keyName && value !== undefined) {
        // Handle _0, _1 for exact numeric matches
        if (keyName.startsWith("_")) {
          options["=" + keyName.slice(1)] = value
        } else {
          options[keyName] = value
        }
      }
    }
  }

  return options
}

/**
 * Get string value from an AST node
 */
function getStringValue(node: Record<string, unknown>): string | undefined {
  if (!node) {
    return undefined
  }

  if (node.type === "StringLiteral" || node.type === "Literal") {
    const value = node.value
    if (typeof value === "string") {
      return value
    }
  }

  if (node.type === "TemplateLiteral") {
    const quasis = node.quasis as Array<Record<string, unknown>> | undefined
    const expressions = node.expressions as unknown[] | undefined

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
 * Extract attributes from a JSX opening element
 */
function extractJSXAttributes(openingElement: Record<string, unknown>): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {}
  const attributes = openingElement.attributes as Array<Record<string, unknown>> | undefined

  if (!attributes) {
    return result
  }

  for (const attr of attributes) {
    if (attr.type === "JSXAttribute") {
      const name = attr.name as Record<string, unknown> | undefined
      const attrName = name?.name as string | undefined

      if (!attrName) {
        continue
      }

      const value = attr.value as Record<string, unknown> | undefined

      // Handle value={expr} for Plural/Select
      if (attrName === "value" && value?.type === "JSXExpressionContainer") {
        const expr = value.expression as Record<string, unknown>
        result._valueName = extractExpressionName(expr) ?? "0"
        continue
      }

      // Get string value
      result[attrName] = getJSXAttributeValue(value)
    }
  }

  return result
}

/**
 * Get string value from a JSX attribute value
 */
function getJSXAttributeValue(valueNode: Record<string, unknown> | undefined): string | undefined {
  if (!valueNode) {
    return undefined
  }

  // String literal: "hello"
  if (valueNode.type === "StringLiteral" || valueNode.type === "Literal") {
    const value = valueNode.value
    if (typeof value === "string") {
      return value
    }
  }

  // Expression container: {"hello"} or {`hello`}
  if (valueNode.type === "JSXExpressionContainer") {
    const expr = valueNode.expression as Record<string, unknown>
    return getStringValue(expr)
  }

  return undefined
}

/**
 * Extract message and values from JSX children
 */
function extractJSXChildrenAsMessage(
  children: Array<Record<string, unknown>>,
  code: string
): { message: string; values: string[]; components: string[] } {
  const parts: string[] = []
  const values: string[] = []
  const components: string[] = []
  let placeholderIndex = 0

  for (const child of children) {
    if (child.type === "JSXText") {
      const text = cleanJSXText(child.value as string)
      if (text) {
        parts.push(text)
      }
    } else if (child.type === "JSXExpressionContainer") {
      const expr = child.expression as Record<string, unknown>
      if (expr.type === "StringLiteral" || expr.type === "Literal") {
        const value = expr.value
        if (typeof value === "string") {
          parts.push(value)
        }
      } else if (expr.type === "Identifier") {
        const name = expr.name as string
        parts.push(`{${name}}`)
        values.push(name)
      } else {
        // Complex expression - use numeric placeholder
        parts.push(`{${placeholderIndex}}`)
        const name = extractExpressionName(expr) ?? String(placeholderIndex)
        values.push(name)
        placeholderIndex++
      }
    } else if (child.type === "JSXElement") {
      // Nested element: <Trans>Hello <b>world</b></Trans> → "Hello <0>world</0>"
      const innerChildren = child.children as Array<Record<string, unknown>> | undefined
      const { message: innerText, values: innerValues, components: innerComponents } = extractJSXChildrenAsMessage(
        innerChildren || [],
        code
      )
      parts.push(`<${placeholderIndex}>${innerText}</${placeholderIndex}>`)
      values.push(...innerValues)

      // Extract the JSX element tag to use as component
      const openingElement = child.openingElement as Record<string, unknown>
      const tagName = getJSXTagName(openingElement)
      const attrsCode = extractJSXAttributesAsCode(openingElement, code)
      components.push(`<${tagName}${attrsCode} />`)
      components.push(...innerComponents)

      placeholderIndex++
    }
  }

  return {
    message: parts.join("").trim(),
    values,
    components,
  }
}

/**
 * Get the tag name from a JSX opening element
 */
function getJSXTagName(openingElement: Record<string, unknown>): string {
  const name = openingElement.name as Record<string, unknown>
  if (name.type === "JSXIdentifier") {
    return name.name as string
  }
  if (name.type === "JSXMemberExpression") {
    const obj = name.object as Record<string, unknown>
    const prop = name.property as Record<string, unknown>
    return `${obj.name}.${prop.name}`
  }
  return "span"
}

/**
 * Extract JSX attributes as code string (excluding children)
 */
function extractJSXAttributesAsCode(openingElement: Record<string, unknown>, code: string): string {
  const attrs = openingElement.attributes as Array<Record<string, unknown>> | undefined
  if (!attrs || attrs.length === 0) {
    return ""
  }

  const attrStrings: string[] = []
  for (const attr of attrs) {
    if (attr.type === "JSXAttribute") {
      const start = attr.start as number
      const end = attr.end as number
      attrStrings.push(code.slice(start, end))
    }
  }

  return attrStrings.length > 0 ? " " + attrStrings.join(" ") : ""
}

/**
 * Clean JSX text (remove extra whitespace)
 */
function cleanJSXText(text: string): string {
  return text.replace(/\s+/g, " ")
}

/**
 * Escape a string for use in a JS string literal
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
}
