/**
 * @palamedes/vite-plugin
 *
 * Vite plugin for Lingui using OXC-based macro transformer.
 * No Babel required!
 */

import path from "node:path"
import type { Plugin, FilterPattern } from "vite"
import { createFilter } from "vite"
import { getConfig, type LinguiConfigNormalized, type FallbackLocales } from "@lingui/conf"
import {
  createCompiledCatalog,
  getCatalogs,
  getCatalogForFile,
  getCatalogDependentFiles,
  createMissingErrorMessage,
  createCompilationErrorMessage,
} from "@lingui/cli/api"
import { transformLinguiMacros } from "@palamedes/transform"

const PO_FILE_REGEX = /(\.po|\?palamedes)$/

type TranslationOptions = {
  sourceLocale: string
  fallbackLocales: FallbackLocales
}

export interface PalamedesPluginOptions {
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
   * Path to lingui.config.js.
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
    ...linguiConfigOptions
  } = options

  // Initialize lazily
  let config: LinguiConfigNormalized | null = null
  let filter: ReturnType<typeof createFilter> | null = null
  let macroIds: Set<string> | null = null

  function getConfigLazy() {
    if (!config) {
      config = getConfig(linguiConfigOptions)
      macroIds = new Set([
        ...(config.macro?.corePackage ?? []),
        ...(config.macro?.jsxPackage ?? []),
      ])
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
      // Ensure config is loaded
      getConfigLazy()
      const ids = macroIds!
      if (ids.has(id)) {
        throw new Error(
          `The macro you imported from "${id}" is being executed outside the context of compilation.\n` +
            `This indicates that @palamedes/vite-plugin is not transforming the file.\n` +
            `Please ensure the plugin is configured correctly in your vite.config.ts`
        )
      }
    },

    resolveDynamicImport(id) {
      const ids = macroIds!
      if (ids.has(id as string)) {
        throw new Error(
          `The macro you imported from "${id}" cannot be dynamically imported.\n` +
            `Lingui macros must be statically imported.`
        )
      }
    },
  })

  // Plugin 2: Transform macros
  plugins.push({
    name: "palamedes:transform",
    enforce: "pre" as const,

    config(viteConfig) {
      // Ensure config is loaded to populate macroIds
      getConfigLazy()
      const ids = macroIds!

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
        // Check file extension and filter
        if (!getFilterLazy()(id)) {
          return null
        }

        // Quick check: skip if no macro imports
        const ids = macroIds!
        const hasAnyMacroImport = Array.from(ids).some((macroId) =>
          code.includes(macroId)
        )
        if (!hasAnyMacroImport) {
          return null
        }

        try {
          const result = transformLinguiMacros(code, id, {
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
          this.error(`Lingui transform error in ${id}: ${err.message}`)
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

        const cfg = getConfigLazy()
        const cleanId = id.split("?")[0] ?? id
        const catalogRelativePath = path.relative(cfg.rootDir ?? process.cwd(), cleanId)

        const fileCatalog = getCatalogForFile(
          catalogRelativePath,
          await getCatalogs(cfg)
        )

        if (!fileCatalog) {
          throw new Error(
              `Requested resource ${catalogRelativePath} is not matched to any of your catalogs paths specified in "lingui.config".\n\n` +
              `Resource: ${id}\n\n` +
              `Your catalogs:\n${(cfg.catalogs ?? []).map((c) => c.path).join("\n")}\n\n` +
              `Please check that catalogs.path is filled properly.`
          )
        }

        const { locale, catalog } = fileCatalog

        // Add dependencies for HMR
        const dependency = await getCatalogDependentFiles(catalog, locale)
        dependency.forEach((file) => this.addWatchFile(file))
        const translationOptions: TranslationOptions = {
          sourceLocale: cfg.sourceLocale!,
          fallbackLocales: (cfg.fallbackLocales ?? {}) as FallbackLocales,
        }

        const { messages, missing: missingMessages } =
          await catalog.getTranslations(locale, translationOptions)

        // Check for missing translations
        if (
          failOnMissing &&
          locale !== cfg.pseudoLocale &&
          missingMessages.length > 0
        ) {
          const message = createMissingErrorMessage(
            locale,
            missingMessages,
            "loader"
          )
          throw new Error(
            `${message}\nYou see this error because \`failOnMissing=true\` in Vite Plugin configuration.`
          )
        }

        // Compile the catalog
        const { source: compiledCode, errors } = createCompiledCatalog(
          locale,
          messages,
          {
            namespace: "es",
            pseudoLocale: cfg.pseudoLocale,
          }
        )

        // Handle compilation errors
        if (errors.length) {
          const message = createCompilationErrorMessage(locale, errors)

          if (failOnCompileError) {
            throw new Error(
              message +
                `These errors fail build because \`failOnCompileError=true\` in Lingui Vite plugin configuration.`
            )
          } else {
            console.warn(
              message +
                `You can fail the build on these errors by setting \`failOnCompileError=true\` in Lingui Vite Plugin configuration.`
            )
          }
        }

        return {
          code: compiledCode,
          map: null,
        }
      },
    })
  }

  return plugins
}

export default palamedes
