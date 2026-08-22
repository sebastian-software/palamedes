import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import path from "node:path"
import type { registerHooks } from "node:module"

import { loadPalamedesConfigSync, type LoadedPalamedesConfig } from "@palamedes/config"
import { compileCatalogModule } from "@palamedes/core-node"
import {
  resolveMacroRuntimeModule,
  transformPalamedesMacros,
  type SourceMap,
} from "@palamedes/transform"

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
   * Advanced override for the module imported for the runtime i18n getter.
   * @default "@palamedes/runtime"
   */
  runtimeModule?: string

  /**
   * Preserve authored source messages as runtime fallbacks.
   * Defaults to `true` in every environment. Set to `false` for compact,
   * hash-only output when bundle size or embedding authored source text is a
   * concern.
   */
  keepSourceFallbacks?: boolean

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

type CachedPalamedesConfig = {
  config: LoadedPalamedesConfig
  digest: string
}

export function createPalamedesRemixLoadHook(
  options: PalamedesRemixRegisterOptions = {}
): LoadHook {
  const include = options.include ?? DEFAULT_INCLUDE
  const exclude = options.exclude ?? DEFAULT_EXCLUDE
  const runtimeModule = resolveMacroRuntimeModule(options.runtimeModule)
  // Keep misses readable across production deploy skew by default. Hosts that
  // must not embed authored text can choose the compact, hash-only behavior.
  const keepSourceFallbacks = options.keepSourceFallbacks ?? true
  const stripNonEssentialProps = process.env.NODE_ENV === "production"
  const configCache = new Map<string, CachedPalamedesConfig>()

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
      keepSourceFallbacks,
      stripNonEssentialProps,
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
  configCache: Map<string, CachedPalamedesConfig>
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
  configCache: Map<string, CachedPalamedesConfig>
): LoadedPalamedesConfig {
  const cwd = path.dirname(resourcePath)
  const cacheKey = `${cwd}\0${configPath ?? ""}`
  const cached = configCache.get(cacheKey)
  if (cached && isCurrentConfig(cached)) {
    return cached.config
  }

  const config = loadPalamedesConfigSync({ cwd, configPath })
  cacheConfig(configCache, cacheKey, config)
  return config
}

function isCurrentConfig(cached: CachedPalamedesConfig): boolean {
  try {
    return digestConfig(cached.config.configPath) === cached.digest
  } catch {
    return false
  }
}

function cacheConfig(
  configCache: Map<string, CachedPalamedesConfig>,
  cacheKey: string,
  config: LoadedPalamedesConfig
): void {
  try {
    configCache.set(cacheKey, { config, digest: digestConfig(config.configPath) })
  } catch {
    // Tests and virtual configs may not have a readable config file.
  }
}

function digestConfig(configPath: string): string {
  return createHash("sha256").update(readFileSync(configPath)).digest("hex")
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
