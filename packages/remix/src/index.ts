import { fileURLToPath } from "node:url"
import path from "node:path"
import type { registerHooks } from "node:module"

import { loadPalamedesConfigSync, type LoadedPalamedesConfig } from "@palamedes/config"
import { compileCatalogModule } from "@palamedes/core-node"
import { transformPalamedesMacros, type SourceMap } from "@palamedes/transform"

export type PalamedesRemixRegisterOptions = {
  /**
   * Files eligible for macro transformation.
   * @default /\.(tsx?|jsx?|mjs)$/
   */
  include?: RegExp

  /**
   * Files excluded from macro transformation.
   * @default /[/\\]node_modules[/\\]/
   */
  exclude?: RegExp

  /**
   * Module imported for the runtime i18n getter.
   * @default "@palamedes/runtime"
   */
  runtimeModule?: string

  /**
   * Optional Palamedes config path used for `.po` catalog imports.
   * Relative paths resolve from the imported catalog file's directory.
   */
  configPath?: string

  /**
   * Fail `.po` catalog compilation when a translation is missing.
   * @default false
   */
  failOnMissing?: boolean

  /**
   * Fail `.po` catalog compilation when catalog diagnostics include errors.
   * @default false
   */
  failOnCompileError?: boolean
}

type RegisterHooksOptions = Parameters<typeof registerHooks>[0]

export type LoadHook = NonNullable<RegisterHooksOptions["load"]>
export type LoadResult = ReturnType<LoadHook>

const DEFAULT_INCLUDE = /\.(tsx?|jsx?|mjs)$/
const DEFAULT_EXCLUDE = /[/\\]node_modules[/\\]/
const PO_FILE = /\.po$/
const INLINE_SOURCE_MAP_COMMENT =
  /(?:\r?\n)?\/\/# sourceMappingURL=data:application\/json[^,\r\n]*;base64,[^\r\n]+(?:\r?\n)?$/u

export function createPalamedesRemixLoadHook(
  options: PalamedesRemixRegisterOptions = {}
): LoadHook {
  const include = options.include ?? DEFAULT_INCLUDE
  const exclude = options.exclude ?? DEFAULT_EXCLUDE
  const runtimeModule = options.runtimeModule ?? "@palamedes/runtime"
  const configCache = new Map<string, LoadedPalamedesConfig>()

  return (url, context, nextLoad) => {
    if (shouldLoadCatalogUrl(url, exclude)) {
      return loadCatalogModule(url, options, configCache)
    }

    const loaded = nextLoad(url, context)
    if (!shouldTransformUrl(url, include, exclude) || loaded.source == null) {
      return loaded
    }

    const code = stringifySource(loaded.source)
    const result = transformPalamedesMacros(code, fileURLToPath(url), {
      runtimeModule,
    })

    if (!result.hasChanged) {
      return loaded
    }

    return {
      ...loaded,
      source: appendInlineSourceMap(stripInlineSourceMap(result.code), result.map),
    }
  }
}

function shouldLoadCatalogUrl(url: string, exclude: RegExp): boolean {
  if (!url.startsWith("file:")) {
    return false
  }

  const filePath = fileURLToPath(url)
  return PO_FILE.test(filePath) && !exclude.test(filePath)
}

function loadCatalogModule(
  url: string,
  options: Pick<
    PalamedesRemixRegisterOptions,
    "configPath" | "failOnMissing" | "failOnCompileError"
  >,
  configCache: Map<string, LoadedPalamedesConfig>
): LoadResult {
  const resourcePath = fileURLToPath(url)
  const config = getPalamedesConfigForCatalog(resourcePath, options.configPath, configCache)
  const locale = path.basename(resourcePath, ".po")
  const result = compileCatalogModule(
    {
      rootDir: config.rootDir,
      locales: config.locales,
      sourceLocale: config.sourceLocale,
      fallbackLocales: config.fallbackLocales,
      pseudoLocale: config.pseudoLocale,
      catalogs: config.catalogs,
    },
    resourcePath,
    {
      locale,
      pseudoLocale: config.pseudoLocale,
      failOnMissing: options.failOnMissing === true,
      failOnCompileError: options.failOnCompileError === true,
      missingFailureHint:
        "You see this error because `failOnMissing=true` in Palamedes Remix register options.",
      compileFailureHint:
        "These errors fail loading because `failOnCompileError=true` in Palamedes Remix register options.",
      diagnosticsWarningHint:
        "You can fail loading on error diagnostics by setting `failOnCompileError=true` in Palamedes Remix register options.",
    }
  )

  result.warnings.forEach((warning) => console.warn(warning))

  return {
    format: "module",
    shortCircuit: true,
    source: result.code,
  }
}

function getPalamedesConfigForCatalog(
  resourcePath: string,
  configPath: string | undefined,
  configCache: Map<string, LoadedPalamedesConfig>
): LoadedPalamedesConfig {
  const cwd = path.dirname(resourcePath)
  const cacheKey = `${cwd}\0${configPath ?? ""}`
  const cached = configCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const config = loadPalamedesConfigSync({ cwd, configPath })
  configCache.set(cacheKey, config)
  return config
}

function shouldTransformUrl(url: string, include: RegExp, exclude: RegExp): boolean {
  if (!url.startsWith("file:")) {
    return false
  }

  const filePath = fileURLToPath(url)
  return include.test(filePath) && !exclude.test(filePath)
}

function stringifySource(source: NonNullable<LoadResult["source"]>): string {
  if (typeof source === "string") {
    return source
  }

  if (source instanceof ArrayBuffer) {
    return Buffer.from(source).toString("utf8")
  }

  return Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString("utf8")
}

function stripInlineSourceMap(code: string): string {
  return code.replace(INLINE_SOURCE_MAP_COMMENT, "")
}

function appendInlineSourceMap(code: string, map: SourceMap | null): string {
  if (!map) {
    return code
  }

  const encoded = Buffer.from(JSON.stringify(map), "utf8").toString("base64")
  return `${code}\n//# sourceMappingURL=data:application/json;base64,${encoded}`
}
