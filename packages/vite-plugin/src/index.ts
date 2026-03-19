/**
 * @palamedes/vite-plugin
 *
 * Vite plugin for Palamedes using OXC-based macro transformation.
 * No Babel required!
 */

import path from "node:path"
import type { Plugin, FilterPattern } from "vite"
import { createFilter } from "vite"
import {
  loadPalamedesConfig,
  type LoadedPalamedesConfig,
} from "@palamedes/config"
import { compileCatalogArtifact } from "@palamedes/core-node"
import { transformPalamedesMacros } from "@palamedes/transform"
import { PALAMEDES_MACRO_PACKAGES } from "@palamedes/transform"

const PO_FILE_REGEX = /(\.po|\?palamedes)$/

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
   * Path to palamedes.config.js/ts.
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

function createMissingErrorMessage(
  locale: string,
  missingMessages: Array<{ sourceKey: { message: string; context?: string } }>
): string {
  const lines = missingMessages.map((missing) =>
    missing.sourceKey.context
      ? `${missing.sourceKey.message} [context: ${missing.sourceKey.context}]`
      : missing.sourceKey.message
  )
  return `Failed to compile catalog for locale ${locale}!\n\nMissing ${missingMessages.length} translation(s):\n${lines.join("\n")}`
}

function createDiagnosticMessage(
  locale: string,
  diagnostics: Array<{
    severity: "info" | "warning" | "error"
    code: string
    message: string
    sourceKey: { message: string; context?: string }
    locale: string
  }>
): string {
  const lines = diagnostics.map((diagnostic) => {
    const source = diagnostic.sourceKey.context
      ? `${diagnostic.sourceKey.message} [context: ${diagnostic.sourceKey.context}]`
      : diagnostic.sourceKey.message
    return `[${diagnostic.severity}] ${diagnostic.code} (${diagnostic.locale})\n${diagnostic.message}\nSource: ${source}`
  })
  return `Catalog diagnostics for locale ${locale}:\n\n${lines.join("\n\n")}`
}

function createCompileErrorMessage(
  locale: string,
  diagnostics: Array<{
    code: string
    message: string
    sourceKey: { message: string; context?: string }
    locale: string
  }>
): string {
  const lines = diagnostics.map((diagnostic) => {
    const source = diagnostic.sourceKey.context
      ? `${diagnostic.sourceKey.message} [context: ${diagnostic.sourceKey.context}]`
      : diagnostic.sourceKey.message
    return `${diagnostic.message}\nCode: ${diagnostic.code}\nLocale: ${diagnostic.locale}\nSource: ${source}`
  })
  return `Failed to compile catalog for locale ${locale}!\n\nCompilation error for ${diagnostics.length} translation(s):\n${lines.join("\n\n")}`
}

function warnDiagnostics(locale: string, diagnostics: Array<{
  severity: "info" | "warning" | "error"
  code: string
  message: string
  sourceKey: { message: string; context?: string }
  locale: string
}>): void {
  if (diagnostics.length === 0) {
    return
  }

  console.warn(
    `${createDiagnosticMessage(locale, diagnostics)}\n\nYou can fail the build on error diagnostics by setting \`failOnCompileError=true\` in the Palamedes Vite plugin configuration.`
  )
}

function renderCatalogModule(messages: Record<string, string>): string {
  return `export const messages=${JSON.stringify(messages)};export default { messages };`
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
        throw new Error(
          `The macro you imported from "${id}" is being executed outside the context of compilation.\n` +
            `This indicates that @palamedes/vite-plugin is not transforming the file.\n` +
            `Please ensure the plugin is configured correctly in your vite.config.ts`
        )
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
      // Check file extension and filter
      if (!getFilterLazy()(id)) {
        return null
      }

      // Quick check: skip if no macro imports
      const ids = macroIds ?? new Set(PALAMEDES_MACRO_PACKAGES)
      const hasAnyMacroImport = Array.from(ids).some((macroId) =>
        code.includes(macroId)
      )
      if (!hasAnyMacroImport) {
        return null
      }

      try {
        const result = transformPalamedesMacros(code, id, {
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
        this.error(`Palamedes transform error in ${id}: ${err.message}`)
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
        const cleanId = id.split("?")[0] ?? id
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

        // Check for missing translations
        if (
          failOnMissing &&
          locale !== cfg.pseudoLocale &&
          result.missing.length > 0
        ) {
          const message = createMissingErrorMessage(
            locale,
            result.missing
          )
          throw new Error(
            `${message}\nYou see this error because \`failOnMissing=true\` in Vite Plugin configuration.`
          )
        }

        // Handle compilation errors
        if (result.diagnostics.length) {
          const errorDiagnostics = result.diagnostics.filter(
            (diagnostic) => diagnostic.severity === "error"
          )

          if (failOnCompileError && errorDiagnostics.length > 0) {
            const message = createCompileErrorMessage(locale, errorDiagnostics)
            throw new Error(
              message +
                `These errors fail build because \`failOnCompileError=true\` in the Palamedes Vite plugin configuration.`
            )
          }

          warnDiagnostics(locale, result.diagnostics)
        }

        return {
          code: renderCatalogModule(result.messages),
          map: null,
        }
      },
    })
  }

  return plugins
}

export default palamedes
