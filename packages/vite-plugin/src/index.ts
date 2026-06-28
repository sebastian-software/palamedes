/**
 * @palamedes/vite-plugin
 *
 * Vite plugin for Palamedes using OXC-based macro transformation.
 * No Babel required!
 */

import path from "node:path"
import type { Plugin, FilterPattern } from "vite"
import { createFilter } from "vite"
import { loadPalamedesConfig, type LoadedPalamedesConfig } from "@palamedes/config"
import { compileCatalogArtifact } from "@palamedes/core-node"
import { createCatalogLoaderResult } from "@palamedes/transform/catalog-loader"
import { transformPalamedesMacros } from "@palamedes/transform"
import { PALAMEDES_MACRO_PACKAGES } from "@palamedes/transform"

const PO_FILE_REGEX = /(\.po|\?palamedes)$/
const VIRTUAL_MACRO_ERROR_PREFIX = "\0palamedes:macro-error:"

function stripQuery(id: string): string {
  return id.split("?")[0] ?? id
}

export type PalamedesPluginOptions = {
  /**
   * Pattern to include files for transformation.
   * @default /\.(tsx?|jsx?|mjs|cjs)$/
   */
  include?: FilterPattern

  /**
   * Pattern to exclude files from transformation.
   * @default /node_modules/
   */
  exclude?: FilterPattern

  /**
   * Enable .po file compilation loader.
   * @default true
   */
  enablePoLoader?: boolean

  /**
   * Path to a Palamedes config file.
   * If not provided, searches for config automatically.
   */
  configPath?: string

  /**
   * Current working directory for config resolution.
   */
  cwd?: string

  /**
   * Skip validation of the config file.
   */
  skipValidation?: boolean

  /**
   * If true, fail compilation on missing translations.
   * @default false
   */
  failOnMissing?: boolean

  /**
   * If true, fail compilation on message compilation errors.
   * @default false
   */
  failOnCompileError?: boolean

  /**
   * Module to import the runtime getter from.
   * @default "@palamedes/runtime"
   */
  runtimeModule?: string
}

/**
 * Create the Palamedes Vite plugin
 */
export function palamedes(options: PalamedesPluginOptions = {}): Plugin[] {
  const {
    include = /\.(tsx?|jsx?|mjs|cjs)$/,
    exclude = /node_modules/,
    enablePoLoader = true,
    failOnMissing = false,
    failOnCompileError = false,
    runtimeModule = "@palamedes/runtime",
    ...configLoaderOptions
  } = options

  // Initialize lazily
  let config: LoadedPalamedesConfig | null = null
  let filter: ReturnType<typeof createFilter> | null = null
  let macroIds: Set<string> | null = null

  async function getConfigLazy() {
    if (!config) {
      config = await loadPalamedesConfig(configLoaderOptions)
      macroIds = new Set(PALAMEDES_MACRO_PACKAGES)
    }
    return config
  }

  function getFilterLazy() {
    if (!filter) {
      filter = createFilter(include, exclude)
    }
    return filter
  }

  const plugins: Plugin[] = []

  // Plugin 1: Report macro resolution errors
  plugins.push({
    name: "palamedes:report-macro-error",
    enforce: "pre" as const,

    resolveId(id) {
      const ids = macroIds ?? new Set(PALAMEDES_MACRO_PACKAGES)
      if (ids.has(id)) {
        return `${VIRTUAL_MACRO_ERROR_PREFIX}${id}`
      }
    },

    resolveDynamicImport(id) {
      const ids = macroIds ?? new Set(PALAMEDES_MACRO_PACKAGES)
      if (ids.has(id as string)) {
        throw new Error(
          `The macro you imported from "${id}" cannot be dynamically imported.\n` +
            `Palamedes macros must be statically imported.`
        )
      }
    },

    load(id) {
      if (!id.startsWith(VIRTUAL_MACRO_ERROR_PREFIX)) {
        return null
      }

      const macroId = id.slice(VIRTUAL_MACRO_ERROR_PREFIX.length)
      throw new Error(
        `The macro you imported from "${macroId}" is being executed outside the context of compilation.\n` +
          `This indicates that @palamedes/vite-plugin is not transforming the file.\n` +
          `Please ensure the plugin is configured correctly in your vite.config.ts`
      )
    },
  })

  // Plugin 2: Transform macros
  plugins.push({
    name: "palamedes:transform",
    enforce: "pre" as const,

    config(viteConfig) {
      const ids = new Set(PALAMEDES_MACRO_PACKAGES)
      macroIds = ids

      // Exclude macro packages from optimization
      // https://github.com/lingui/js-lingui/issues/1464
      if (!viteConfig.optimizeDeps) {
        viteConfig.optimizeDeps = {}
      }
      viteConfig.optimizeDeps.exclude = viteConfig.optimizeDeps.exclude || []

      for (const macroId of ids) {
        viteConfig.optimizeDeps.exclude.push(macroId)
      }
    },

    transform(code, id) {
      const cleanId = stripQuery(id)

      // Check file extension and filter
      if (!getFilterLazy()(cleanId)) {
        return null
      }

      // Quick check: skip if no macro imports
      const ids = macroIds ?? new Set(PALAMEDES_MACRO_PACKAGES)
      const hasAnyMacroImport = [...ids].some((macroId) => code.includes(macroId))
      if (!hasAnyMacroImport) {
        return null
      }

      try {
        const result = transformPalamedesMacros(code, cleanId, {
          runtimeModule,
        })

        if (!result.hasChanged) {
          return null
        }

        return {
          code: result.code,
          map: result.map as any,
        }
      } catch (error) {
        const err = error as Error
        this.error(`Palamedes transform error in ${cleanId}: ${err.message}`)
      }
    },
  })

  // Plugin 3: PO file loader
  if (enablePoLoader) {
    plugins.push({
      name: "palamedes:po-loader",

      async transform(src, id) {
        if (!PO_FILE_REGEX.test(id)) {
          return null
        }

        const cfg = await getConfigLazy()
        const cleanId = stripQuery(id)
        const result = compileCatalogArtifact(
          {
            rootDir: cfg.rootDir,
            locales: cfg.locales,
            sourceLocale: cfg.sourceLocale,
            fallbackLocales: cfg.fallbackLocales,
            pseudoLocale: cfg.pseudoLocale,
            catalogs: cfg.catalogs,
          },
          cleanId
        )

        result.watchFiles.forEach((file: string) => this.addWatchFile(file))
        const locale = path.basename(cleanId, ".po")

        const loaderResult = createCatalogLoaderResult(result, {
          locale,
          pseudoLocale: cfg.pseudoLocale,
          failOnMissing,
          failOnCompileError,
          missingFailureHint:
            "You see this error because `failOnMissing=true` in Vite plugin configuration.",
          compileFailureHint:
            "These errors fail the build because `failOnCompileError=true` in the Palamedes Vite plugin configuration.",
          diagnosticsWarningHint:
            "You can fail the build on error diagnostics by setting `failOnCompileError=true` in the Palamedes Vite plugin configuration.",
        })

        loaderResult.warnings.forEach((warning) => console.warn(warning))

        return {
          code: loaderResult.code,
          map: null,
        }
      },
    })
  }

  return plugins
}

export default palamedes
