import chalk from "chalk"
import { loadPalamedesConfig, type LoadedPalamedesConfig } from "@palamedes/config"
import {
  auditCatalogs,
  type CatalogAuditDiagnostic,
  type CatalogAuditResult,
} from "@palamedes/core-node"

type AuditOptions = {
  config?: string
  locale?: string[]
  json?: boolean
  failOn?: "error" | "warning"
}

export async function audit(options: AuditOptions): Promise<CatalogAuditResult> {
  const config = await loadPalamedesConfig({ configPath: options.config })
  const result = auditCatalogs(toAuditConfig(config), {
    locales: options.locale,
  })

  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    printAuditResult(result)
  }

  const failOn = normalizeFailOn(options.failOn)
  if (shouldFail(result, failOn)) {
    throw new Error(createFailureMessage(result, failOn))
  }

  return result
}

function toAuditConfig(config: LoadedPalamedesConfig) {
  return {
    rootDir: config.rootDir,
    locales: config.locales,
    sourceLocale: config.sourceLocale,
    fallbackLocales: config.fallbackLocales,
    pseudoLocale: config.pseudoLocale,
    catalogs: config.catalogs,
  }
}

function printAuditResult(result: CatalogAuditResult): void {
  const { summary } = result
  const status = summary.errors > 0 ? chalk.red("failed") : chalk.green("passed")
  console.log(
    `Catalog audit ${status}: ${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.infos} info`
  )

  if (result.diagnostics.length === 0) {
    return
  }

  for (const [catalogPath, diagnostics] of groupByCatalog(result.diagnostics)) {
    console.log(chalk.gray(`\n${catalogPath}`))
    for (const diagnostic of diagnostics) {
      const severity = formatSeverity(diagnostic.severity)
      const locale = diagnostic.locale ? ` ${chalk.gray(`[${diagnostic.locale}]`)}` : ""
      const source = formatSource(diagnostic)
      console.log(`  ${severity} ${diagnostic.code}${locale}: ${diagnostic.message}${source}`)
    }
  }
}

function groupByCatalog(diagnostics: CatalogAuditDiagnostic[]) {
  const grouped = new Map<string, CatalogAuditDiagnostic[]>()
  for (const diagnostic of diagnostics) {
    const entries = grouped.get(diagnostic.catalogPath) ?? []
    entries.push(diagnostic)
    grouped.set(diagnostic.catalogPath, entries)
  }
  return grouped
}

function formatSeverity(severity: CatalogAuditDiagnostic["severity"]): string {
  switch (severity) {
    case "error": {
      return chalk.red("[error]")
    }
    case "warning": {
      return chalk.yellow("[warning]")
    }
    case "info": {
      return chalk.blue("[info]")
    }
  }
}

function formatSource(diagnostic: CatalogAuditDiagnostic): string {
  if (!diagnostic.sourceKey) {
    return ""
  }

  const context = diagnostic.sourceKey.context ? ` [context: ${diagnostic.sourceKey.context}]` : ""
  return chalk.gray(`\n    Source: ${diagnostic.sourceKey.message}${context}`)
}

function shouldFail(result: CatalogAuditResult, failOn: "error" | "warning"): boolean {
  if (failOn === "warning") {
    return result.summary.errors > 0 || result.summary.warnings > 0
  }

  return result.summary.errors > 0
}

function normalizeFailOn(value: AuditOptions["failOn"]): "error" | "warning" {
  if (value === undefined || value === "error" || value === "warning") {
    return value ?? "error"
  }

  throw new Error("Invalid --fail-on value. Expected `error` or `warning`.")
}

function createFailureMessage(result: CatalogAuditResult, failOn: "error" | "warning"): string {
  if (failOn === "warning") {
    return `Catalog audit failed with ${result.summary.errors} error(s) and ${result.summary.warnings} warning(s).`
  }

  return `Catalog audit failed with ${result.summary.errors} error(s).`
}
