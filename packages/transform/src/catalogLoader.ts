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
  const renderer = new RuntimeModuleRenderer()
  const entries = Object.entries(messages).map(([id, pattern]) => {
    let value: string
    try {
      const nodes = parseMessagePattern(pattern)
      value = isConstantText(pattern, nodes)
        ? JSON.stringify(pattern)
        : hasSupportedRuntimeNodes(nodes)
          ? renderer.renderMessage(nodes)
          : renderer.renderLazyMessage(pattern)
    } catch {
      value = renderer.renderLazyMessage(pattern)
    }
    return `[${JSON.stringify(id)}]:${value}`
  })
  return `import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core";${renderer.declarations}export const messages=__palamedesDefineCompiledCatalog({${entries.join(",")}});export default { messages };`
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

class RuntimeModuleRenderer {
  public declarations = ""
  private nextMessage = 0
  private nextChoice = 0
  private nextBranch = 0

  public renderLazyMessage(pattern: string): string {
    const name = this.messageName()
    this.declarations += `const ${name}=(v,r)=>r.pattern(${JSON.stringify(pattern)},v);`
    return name
  }

  public renderMessage(nodes: MessageNode[]): string {
    const expression = this.renderNodes(nodes, false)
    const name = this.messageName()
    this.declarations += `const ${name}=(v,r)=>${expression};`
    return name
  }

  private renderNodes(nodes: MessageNode[], inBranch: boolean): string {
    const parts = nodes.flatMap((node) => this.renderNode(node, inBranch))
    if (
      parts.length === 1 &&
      nodes.length === 1 &&
      (nodes[0]?.type !== "text" || (inBranch && nodes[0].value === "#"))
    ) {
      return parts[0]!
    }
    return `r.join(${parts.join(",")})`
  }

  private renderNode(node: MessageNode, inBranch: boolean): string[] {
    switch (node.type) {
      case "text":
        return this.renderText(node.value, inBranch)
      case "literal":
        return [`r.literal(${JSON.stringify(node.value)})`]
      case "variable":
        return [`r.value(v,${JSON.stringify(node.name)})`]
      case "formatted":
        return [
          `r.${node.format}(v,${JSON.stringify(node.variable)}${
            node.style === undefined ? "" : `,${JSON.stringify(node.style)}`
          })`,
        ]
      case "choice":
        return [this.renderChoice(node, inBranch)]
      case "tag":
        return [`r.tag(${JSON.stringify(node.name)},${this.renderNodes(node.children, inBranch)})`]
    }
  }

  private renderText(value: string, inBranch: boolean): string[] {
    if (!inBranch || !value.includes("#")) {
      return [JSON.stringify(value)]
    }
    const segments = value.split("#")
    const parts: string[] = []
    segments.forEach((segment, index) => {
      if (segment.length > 0) {
        parts.push(JSON.stringify(segment))
      }
      if (index < segments.length - 1) {
        parts.push("r.pound(p)")
      }
    })
    return parts
  }

  private renderChoice(node: Extract<MessageNode, { type: "choice" }>, inBranch: boolean): string {
    const choiceName = `__pc${this.nextChoice++}`
    const branchIsPlural = node.kind === "select" ? inBranch : true
    const entries = Object.entries(node.options).map(([selector, nodes]) => {
      const expression = this.renderNodes(nodes, branchIsPlural)
      const branchName = `__pb${this.nextBranch++}`
      this.declarations += `const ${branchName}=(v,r,p)=>${expression};`
      return `[${JSON.stringify(selector)}]:${branchName}`
    })
    this.declarations += `const ${choiceName}={${entries.join(",")}};`
    const variable = JSON.stringify(node.variable)
    if (node.kind === "select") {
      return `r.select(v,${variable},${choiceName}${inBranch ? ",p" : ""})`
    }
    return `r.plural(v,${variable},${node.offset ?? 0},${JSON.stringify(node.kind)},${choiceName})`
  }

  private messageName(): string {
    return `__pm${this.nextMessage++}`
  }
}

function renderSourceKey(sourceKey: CatalogSourceKey): string {
  return sourceKey.context
    ? `${sourceKey.message} [context: ${sourceKey.context}]`
    : sourceKey.message
}

function appendHint(message: string, hint: string | undefined): string {
  return hint ? `${message}\n\n${hint}` : message
}
