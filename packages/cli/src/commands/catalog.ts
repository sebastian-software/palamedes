import { loadPalamedesConfig } from "@palamedes/config"
import {
  combineCatalogFiles,
  type CatalogConflictStrategy,
  type CatalogFileCombineResult,
  type CatalogFileFormat,
} from "@palamedes/core-node"

export type CatalogFileCombineOptions = {
  config?: string
  output: string
  format?: string
  conflictStrategy?: string
  sourceLocale?: string
  locale?: string
}

export async function mergeCatalog(
  inputPaths: string[],
  options: CatalogFileCombineOptions
): Promise<CatalogFileCombineResult> {
  if (!options.output) {
    throw new Error("Missing required --output path.")
  }
  if (inputPaths.length !== 2) {
    throw new Error(
      `Catalog merge requires exactly two input files, received ${inputPaths.length}.`
    )
  }

  return combineCatalogFiles({
    inputPaths,
    outputPath: options.output,
    format: normalizeFormat(options.format),
    sourceLocale: await resolveSourceLocale(options),
    locale: options.locale,
    conflictStrategy: normalizeConflictStrategy(options.conflictStrategy),
  })
}

function normalizeFormat(value: string | undefined): CatalogFileFormat | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === "po" || value === "ndjson") {
    return value
  }
  throw new Error("Invalid --format value. Expected `po` or `ndjson`.")
}

function normalizeConflictStrategy(value: string | undefined): CatalogConflictStrategy {
  if (value === undefined || value === "use-first") {
    return "useFirst"
  }
  if (value === "use-last") {
    return "useLast"
  }
  if (value === "error") {
    return "error"
  }
  throw new Error(
    "Invalid --conflict-strategy value. Expected `use-first`, `use-last`, or `error`."
  )
}

async function resolveSourceLocale(options: CatalogFileCombineOptions): Promise<string> {
  if (options.sourceLocale) {
    return options.sourceLocale
  }

  try {
    const config = await loadPalamedesConfig({ configPath: options.config })
    return config.sourceLocale
  } catch (error) {
    if (options.config || !isMissingConfigError(error)) {
      throw error
    }
    return "en"
  }
}

function isMissingConfigError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Could not find a Palamedes config.")
}
