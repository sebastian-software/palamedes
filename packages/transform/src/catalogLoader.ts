import { parseMessagePattern, type MessageNode } from "@palamedes/core"

export type CatalogSourceKey = {
  message: string
  context?: string
}

export type MissingCatalogMessage = {
  sourceKey: CatalogSourceKey
}

export type CatalogDiagnostic = {
  severity: "info" | "warning" | "error"
  code: string
  message: string
  sourceKey: CatalogSourceKey
  locale: string
}

export type CatalogCompileArtifactResult = {
  messages: Record<string, string>
  missing: MissingCatalogMessage[]
  diagnostics: CatalogDiagnostic[]
  /** Fallback chain reported by the compiler; the head is the resolved locale. */
  resolvedLocaleChain?: string[]
}

export type CatalogLoaderOptions = {
  locale: string
  pseudoLocale?: string
  failOnMissing?: boolean
  failOnCompileError?: boolean
  missingFailureHint?: string
  compileFailureHint?: string
  diagnosticsWarningHint?: string
}

export type CatalogLoaderResult = {
  code: string
  warnings: string[]
}

export function createCatalogLoaderResult(
  result: CatalogCompileArtifactResult,
  options: CatalogLoaderOptions
): CatalogLoaderResult {
  const warnings: string[] = []
  const {
    pseudoLocale,
    failOnMissing = false,
    failOnCompileError = false,
    missingFailureHint,
    compileFailureHint,
    diagnosticsWarningHint,
  } = options

  /*
   * The caller-supplied locale is often derived from the catalog file's
   * basename, which is wrong for layouts like `{locale}/messages.po`. When
   * the compiler reports the resolved chain, its head is authoritative.
   */
  const locale = result.resolvedLocaleChain?.[0] ?? options.locale

  if (locale !== pseudoLocale && result.missing.length > 0 && failOnMissing) {
    throw new Error(
      appendHint(createMissingErrorMessage(locale, result.missing), missingFailureHint)
    )
  }

  if (result.diagnostics.length > 0) {
    const errorDiagnostics = result.diagnostics.filter(
      (diagnostic) => diagnostic.severity === "error"
    )

    if (failOnCompileError && errorDiagnostics.length > 0) {
      throw new Error(
        appendHint(createCompileErrorMessage(locale, errorDiagnostics), compileFailureHint)
      )
    }

    warnings.push(
      appendHint(
        createDiagnosticMessage(locale, result.diagnostics),
        failOnCompileError ? undefined : diagnosticsWarningHint
      )
    )
  }

  return {
    code: renderCatalogModule(result.messages),
    warnings,
  }
}

export function createMissingErrorMessage(
  locale: string,
  missingMessages: MissingCatalogMessage[]
): string {
  const lines = missingMessages.map((missing) => renderSourceKey(missing.sourceKey))
  return `Failed to compile catalog for locale ${locale}!\n\nMissing ${missingMessages.length} translation(s):\n${lines.join("\n")}`
}

export function createDiagnosticMessage(locale: string, diagnostics: CatalogDiagnostic[]): string {
  const lines = diagnostics.map((diagnostic) => {
    const source = renderSourceKey(diagnostic.sourceKey)
    return `[${diagnostic.severity}] ${diagnostic.code} (${diagnostic.locale})\n${diagnostic.message}\nSource: ${source}`
  })
  return `Catalog diagnostics for locale ${locale}:\n\n${lines.join("\n\n")}`
}

export function createCompileErrorMessage(
  locale: string,
  diagnostics: CatalogDiagnostic[]
): string {
  const lines = diagnostics.map((diagnostic) => {
    const source = renderSourceKey(diagnostic.sourceKey)
    return `${diagnostic.message}\nCode: ${diagnostic.code}\nLocale: ${diagnostic.locale}\nSource: ${source}`
  })
  return `Failed to compile catalog for locale ${locale}!\n\nCompilation error for ${diagnostics.length} translation(s):\n${lines.join("\n\n")}`
}

export function renderCatalogModule(messages: Record<string, string>): string {
  const precompiled = precompileCatalogMessages(messages)
  return `import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core";export const messages=__palamedesDefineCompiledCatalog(${JSON.stringify(messages)},${JSON.stringify(precompiled)});export default { messages };`
}

function precompileCatalogMessages(
  messages: Record<string, string>
): Record<string, MessageNode[] | false> {
  const precompiled: Record<string, MessageNode[] | false> = Object.create(null)

  for (const [id, pattern] of Object.entries(messages)) {
    try {
      const nodes = parseMessagePattern(pattern)
      if (!hasSupportedRuntimeNodes(nodes)) {
        precompiled[id] = false
      } else if (!isConstantText(pattern, nodes)) {
        precompiled[id] = nodes
      }
    } catch {
      // Preserve runtime diagnostics and fallback for invalid patterns when
      // failOnCompileError is disabled.
      precompiled[id] = false
    }
  }

  return precompiled
}

function hasSupportedRuntimeNodes(nodes: MessageNode[]): boolean {
  return nodes.every((node) => {
    if (node.type === "tag") {
      return hasSupportedRuntimeNodes(node.children)
    }
    if (node.type !== "choice") {
      return true
    }
    if (!(["plural", "select", "selectordinal"] as string[]).includes(node.kind)) {
      return false
    }
    return Object.values(node.options).every(hasSupportedRuntimeNodes)
  })
}

function isConstantText(pattern: string, nodes: MessageNode[]): boolean {
  return (
    (pattern.length === 0 && nodes.length === 0) ||
    (nodes.length === 1 && nodes[0]?.type === "text" && nodes[0].value === pattern)
  )
}

function renderSourceKey(sourceKey: CatalogSourceKey): string {
  return sourceKey.context
    ? `${sourceKey.message} [context: ${sourceKey.context}]`
    : sourceKey.message
}

function appendHint(message: string, hint: string | undefined): string {
  return hint ? `${message}\n\n${hint}` : message
}
