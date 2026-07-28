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
  type PalamedesMdxConfig,
} from "@palamedes/config"
import {
  analyzeMdxNative,
  compileCatalogModule,
  type MdxAnalysisResult,
} from "@palamedes/core-node"
import { transformPalamedesMacros } from "@palamedes/transform"
import { PALAMEDES_MACRO_PACKAGES } from "@palamedes/transform"

const PO_FILE_REGEX = /(\.po|\?palamedes)$/
const MDX_FILE_REGEX = /\.mdx$/i
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

  /**
   * Override MDX analysis options from the Palamedes config, or disable MDX.
   * @default configuration `mdx` values with React framework defaults
   */
  mdx?: PalamedesMdxConfig | false
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
    mdx: mdxOverride,
    ...configLoaderOptions
  } = options

  // Initialize lazily
  let config: LoadedPalamedesConfig | null = null
  let filter: ReturnType<typeof createFilter> | null = null
  let macroIds: Set<string> | null = null
  const mdxCache = new Map<
    string,
    { source: string; signature: string; result: MdxAnalysisResult }
  >()
  const mdxModuleIds = new Set<string>()

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

  function matchesTransformFilter(id: string): boolean {
    const includeFilter = getFilterLazy()
    return (
      includeFilter(id) ||
      (mdxOverride !== false &&
        MDX_FILE_REGEX.test(id) &&
        includeFilter(id.replace(/\.mdx$/i, ".tsx")))
    )
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

  // Plugin 2: Compile MDX before framework JSX transforms.
  if (mdxOverride !== false) {
    plugins.push({
      name: "palamedes:mdx",
      enforce: "pre" as const,

      buildStart() {
        config = null
        mdxCache.clear()
        mdxModuleIds.clear()
      },

      watchChange(id) {
        const cleanId = stripQuery(id)
        if (config && path.resolve(cleanId) === path.resolve(config.configPath)) {
          config = null
          mdxCache.clear()
        }
      },

      async transform(source, id) {
        const cleanId = stripQuery(id)
        if (!MDX_FILE_REGEX.test(cleanId) || !matchesTransformFilter(cleanId)) {
          return null
        }

        const cfg = await getConfigLazy()
        const mdx = {
          framework: "react" as const,
          translatableAttributes: ["alt"],
          frontMatterFields: [],
          ...cfg.mdx,
          ...mdxOverride,
        }
        const signature = JSON.stringify(mdx)
        const cached = mdxCache.get(cleanId)
        const result =
          cached?.source === source && cached.signature === signature
            ? cached.result
            : analyzeMdxNative(source, cleanId, mdx)
        mdxCache.set(cleanId, { source, signature, result })
        mdxModuleIds.add(cleanId)
        this.addWatchFile(cfg.configPath)
        for (const catalog of cfg.catalogs) {
          for (const locale of cfg.locales) {
            const extension = catalog.format ?? "po"
            this.addWatchFile(
              path.resolve(cfg.rootDir, `${catalog.path.replace("{locale}", locale)}.${extension}`)
            )
          }
        }

        if (result.diagnostics.length > 0 || !result.code) {
          const details = result.diagnostics
            .map(
              (diagnostic) =>
                `${cleanId}:${diagnostic.primary.line}:${diagnostic.primary.column}: ${diagnostic.message} (${diagnostic.code})`
            )
            .join("\n")
          const primary = result.diagnostics[0]?.primary
          this.error({
            name: "PalamedesMdxError",
            code: "PALAMEDES_MDX",
            id: cleanId,
            message: `Palamedes MDX error:\n${details}`,
            ...(primary
              ? {
                  loc: {
                    file: cleanId,
                    line: primary.line,
                    column: Math.max(0, primary.column - 1),
                  },
                }
              : {}),
          })
        }

        return {
          code: result.code,
          map: result.map,
        }
      },

      handleHotUpdate(context) {
        const cleanId = stripQuery(context.file)
        const isConfig =
          config !== null && path.resolve(cleanId) === path.resolve(config.configPath)
        const isCatalog = /\.(po|fcl)$/i.test(cleanId)
        if (!isConfig && !isCatalog) {
          return
        }
        if (isConfig) {
          config = null
          mdxCache.clear()
        }
        const modules = [...mdxModuleIds]
          .map((id) => context.server.moduleGraph.getModuleById(id))
          .filter((module): module is NonNullable<typeof module> => module !== undefined)
        modules.forEach((module) => context.server.moduleGraph.invalidateModule(module))
        return modules
      },
    })
  }

  // Plugin 3: Transform macros
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
      if (!matchesTransformFilter(cleanId)) {
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

  // Plugin 4: PO file loader
  if (enablePoLoader) {
    plugins.push({
      name: "palamedes:po-loader",

      /*
       * Drop the cached config at the start of every build so edits to
       * palamedes.yaml take effect without a dev-server restart.
       */
      buildStart() {
        config = null
      },

      watchChange(id) {
        if (config && path.resolve(id) === path.resolve(config.configPath)) {
          config = null
        }
      },

      async transform(src, id) {
        if (!PO_FILE_REGEX.test(id)) {
          return null
        }

        const cfg = await getConfigLazy()
        this.addWatchFile(cfg.configPath)
        const cleanId = stripQuery(id)
        const locale = path.basename(cleanId, ".po")
        const result = compileCatalogModule(
          {
            rootDir: cfg.rootDir,
            locales: cfg.locales,
            sourceLocale: cfg.sourceLocale,
            fallbackLocales: cfg.fallbackLocales,
            pseudoLocale: cfg.pseudoLocale,
            catalogs: cfg.catalogs,
          },
          cleanId,
          {
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
          }
        )

        result.watchFiles.forEach((file: string) => this.addWatchFile(file))
        // this.warn deduplicates and shows up in Vite's overlay/diagnostics.
        result.warnings.forEach((warning) => this.warn(warning))

        return {
          code: result.code,
          map: null,
        }
      },
    })
  }

  return plugins
}

export default palamedes
