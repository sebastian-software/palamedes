import { loadPalamedesConfig } from "@palamedes/config"
import {
  mergeCatalogFiles,
  type CatalogMergeFormat,
  type CatalogMergeResult,
} from "@palamedes/core-node"

export interface CatalogMergeOptions {
  config?: string
  output: string
  format?: string
  strategy?: string
  sourceLocale?: string
  locale?: string
}

export async function mergeCatalog(
  inputPaths: string[],
  options: CatalogMergeOptions
): Promise<CatalogMergeResult> {
  if (!options.output) {
    throw new Error("Missing required --output path.")
  }
  if (inputPaths.length !== 2) {
    throw new Error(
      `Catalog merge requires exactly two input files, received ${inputPaths.length}.`
    )
  }

  return mergeCatalogFiles({
    inputPaths,
    outputPath: options.output,
    format: normalizeFormat(options.format),
    sourceLocale: await resolveSourceLocale(options),
    locale: options.locale,
    strategy: normalizeStrategy(options.strategy),
  })
}

function normalizeFormat(value: string | undefined): CatalogMergeFormat | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === "po" || value === "json") {
    return value
  }
  throw new Error("Invalid --format value. Expected `po` or `json`.")
}

function normalizeStrategy(value: string | undefined): "useFirst" {
  if (value === undefined || value === "use-first") {
    return "useFirst"
  }
  throw new Error("Invalid --strategy value. Expected `use-first`.")
}

async function resolveSourceLocale(options: CatalogMergeOptions): Promise<string> {
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
  return (
    error instanceof Error &&
    error.message.startsWith("Could not find a Palamedes config.")
  )
}
