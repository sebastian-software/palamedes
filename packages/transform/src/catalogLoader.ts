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
    locale,
    pseudoLocale,
    failOnMissing = false,
    failOnCompileError = false,
    missingFailureHint,
    compileFailureHint,
    diagnosticsWarningHint,
  } = options

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
  return `export const messages=${JSON.stringify(messages)};export default { messages };`
}

function renderSourceKey(sourceKey: CatalogSourceKey): string {
  return sourceKey.context
    ? `${sourceKey.message} [context: ${sourceKey.context}]`
    : sourceKey.message
}

function appendHint(message: string, hint: string | undefined): string {
  return hint ? `${message}\n\n${hint}` : message
}
