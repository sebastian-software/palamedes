/**
 * @palamedes/vite-plugin
 *
 * Vite plugin for Palamedes using OXC-based macro transformation.
 * No Babel required!
 */

import { realpathSync, statSync } from "node:fs"
import path from "node:path"
import type { Plugin, FilterPattern } from "vite"
import { createFilter, version as viteVersion } from "vite"
import {
  loadPalamedesConfig,
  type PalamedesCatalogConfig,
  type LoadedPalamedesConfig,
  type PalamedesMdxConfig,
} from "@palamedes/config"
import {
  analyzeMdxNative,
  compileCatalogArtifactSelected,
  compileCatalogModule,
  type CatalogArtifactConfig,
} from "@palamedes/core-node"
import { createMissingErrorMessage, transformPalamedesMacros } from "@palamedes/transform"
import { PALAMEDES_MACRO_PACKAGES } from "@palamedes/transform"

const PO_FILE_REGEX = /(\.po|\?palamedes)$/
const MDX_FILE_REGEX = /\.mdx$/i
const VIRTUAL_MACRO_ERROR_PREFIX = "\0palamedes:macro-error:"
const MISSING_CONFIG_ERROR_PREFIX = "Could not find a Palamedes config."
const VITE_MAJOR = Number.parseInt(viteVersion.split(".")[0] ?? "0", 10)
function stripQuery(id: string): string {
  return id.split("?")[0] ?? id
}

function normalizeFilterPath(value: string): string {
  return value.replaceAll("\\", "/")
}

function canonicalPath(value: string): string {
  try {
    return realpathSync.native(value)
  } catch {
    return path.resolve(value)
  }
}

function catalogArtifactConfig(
  cfg: LoadedPalamedesConfig,
  catalogs: PalamedesCatalogConfig[] = cfg.catalogs
): CatalogArtifactConfig {
  return {
    rootDir: cfg.rootDir,
    locales: cfg.locales,
    sourceLocale: cfg.sourceLocale,
    fallbackLocales: cfg.fallbackLocales,
    pseudoLocale: cfg.pseudoLocale,
    catalogs: catalogs.map((catalog) => ({
      path: catalog.path,
      include: catalog.include,
      ...(catalog.exclude ? { exclude: catalog.exclude } : {}),
      ...(catalog.format ? { format: catalog.format } : {}),
    })),
  }
}

function catalogMatchesSource(
  cfg: LoadedPalamedesConfig,
  catalog: PalamedesCatalogConfig,
  id: string
): boolean {
  const rootDir = canonicalPath(cfg.rootDir)
  const normalizePattern = (pattern: string, expandBareDirectory: boolean) => {
    const absolute = path.resolve(rootDir, pattern)
    if (expandBareDirectory) {
      try {
        if (statSync(absolute).isDirectory()) {
          return `${normalizeFilterPath(absolute)}/**/*.{js,jsx,ts,tsx,mdx}`
        }
      } catch {
        // Let the filter handle non-existent paths and glob patterns unchanged.
      }
    }
    return normalizeFilterPath(absolute)
  }
  const include = catalog.include.map((pattern) => normalizePattern(pattern, true))
  const exclude = (catalog.exclude ?? ["**/node_modules/**"]).map((pattern) =>
    normalizePattern(pattern, false)
  )
  return createFilter(include, exclude)(normalizeFilterPath(canonicalPath(id)))
}

function catalogResourcePath(
  cfg: LoadedPalamedesConfig,
  catalog: PalamedesCatalogConfig,
  locale: string
): string {
  const extension = catalog.format ?? "po"
  const configuredPath = path.resolve(cfg.rootDir, catalog.path.replace("{locale}", locale))
  const parsed = path.parse(configuredPath)
  return path.format({ dir: parsed.dir, name: parsed.name, ext: `.${extension}` })
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
   * Module the macro transform imports the runtime getter from. Set it to a
   * framework runtime subpath to make inline `t` / `plural` follow a live
   * locale switch. Generated MDX modules are not affected; they default to the
   * framework's reactive runtime and are configured through `mdx.runtimeModule`.
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
    runtimeModule,
    mdx: mdxOverride,
    ...configLoaderOptions
  } = options
  const macroRuntimeModule = runtimeModule ?? "@palamedes/runtime"

  // Initialize lazily
  let config: LoadedPalamedesConfig | null = null
  let filter: ReturnType<typeof createFilter> | null = null
  let mdxFilter: ReturnType<typeof createFilter> | null = null
  let macroIds: Set<string> | null = null
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

  function getMdxFilterLazy() {
    if (!mdxFilter) {
      mdxFilter = createFilter(undefined, exclude)
    }
    return mdxFilter
  }

  function matchesTransformFilter(id: string): boolean {
    if (mdxOverride !== false && MDX_FILE_REGEX.test(id)) {
      return getMdxFilterLazy()(id)
    }
    return getFilterLazy()(id)
  }

  function resolveMdxOptions(cfg: LoadedPalamedesConfig): PalamedesMdxConfig {
    /*
     * The macro `runtimeModule` is deliberately not a fallback here. It is an
     * opt-in that trades the framework-agnostic default for a reactive one,
     * while generated MDX modules already default to the framework's reactive
     * runtime subpath. Letting the macro option leak in would silently
     * downgrade MDX whenever a project pins the macro target.
     */
    return {
      ...cfg.mdx,
      ...mdxOverride,
    }
  }

  function isMissingAutoConfig(error: unknown): boolean {
    return (
      configLoaderOptions.configPath === undefined &&
      error instanceof Error &&
      error.message.startsWith(MISSING_CONFIG_ERROR_PREFIX)
    )
  }

  function validateMdxTranslations(
    cfg: LoadedPalamedesConfig,
    id: string,
    compiledIds: string[],
    addWatchFile: (file: string) => void
  ): void {
    if (!failOnMissing || compiledIds.length === 0) {
      return
    }

    const catalogs = cfg.catalogs.filter((catalog) => catalogMatchesSource(cfg, catalog, id))
    if (catalogs.length === 0) {
      throw new Error(
        `Cannot validate MDX translations for ${id}: the file is not included in a configured catalog.`
      )
    }

    for (const catalog of catalogs) {
      const artifactConfig = catalogArtifactConfig(cfg, [catalog])
      for (const locale of cfg.locales) {
        if (locale === cfg.sourceLocale || locale === cfg.pseudoLocale) {
          continue
        }
        const resourcePath = catalogResourcePath(cfg, catalog, locale)
        const result = compileCatalogArtifactSelected(artifactConfig, resourcePath, compiledIds)
        result.watchFiles.forEach(addWatchFile)
        if (result.missing.length > 0) {
          throw new Error(
            `${createMissingErrorMessage(locale, result.missing)}\n\n` +
              "You see this error because `failOnMissing=true` in Vite plugin configuration."
          )
        }
      }
    }
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

      async config() {
        let cfg: LoadedPalamedesConfig
        try {
          cfg = await getConfigLazy()
        } catch (error) {
          if (isMissingAutoConfig(error)) {
            return
          }
          throw error
        }
        const mdx = resolveMdxOptions(cfg)
        if ((mdx.framework ?? "react") === "solid") {
          return
        }
        return {
          build: {
            rollupOptions: {
              moduleTypes: {
                ".mdx": "jsx",
              },
            },
          },
        }
      },

      buildStart() {
        config = null
        mdxModuleIds.clear()
      },

      watchChange(id, change) {
        const cleanId = stripQuery(id)
        if (change.event === "delete") {
          mdxModuleIds.delete(cleanId)
        }
        if (config && path.resolve(cleanId) === path.resolve(config.configPath)) {
          config = null
        }
      },

      async transform(source, id) {
        const cleanId = stripQuery(id)
        if (!MDX_FILE_REGEX.test(cleanId) || !matchesTransformFilter(cleanId)) {
          return null
        }
        if (VITE_MAJOR < 7) {
          this.error(
            "Palamedes MDX compilation requires Vite 7 or newer. Disable it with `mdx: false` when using an older Vite release."
          )
        }

        const cfg = await getConfigLazy()
        const mdx = resolveMdxOptions(cfg)
        const result = analyzeMdxNative(source, cleanId, mdx)
        mdxModuleIds.add(cleanId)
        this.addWatchFile(cfg.configPath)
        validateMdxTranslations(cfg, cleanId, result.compiledIds, (file) => this.addWatchFile(file))

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
          ...((mdx.framework ?? "react") === "react" ? { moduleType: "jsx" as const } : {}),
        }
      },

      handleHotUpdate(context) {
        const cleanId = stripQuery(context.file)
        const isConfig =
          config !== null && path.resolve(cleanId) === path.resolve(config.configPath)
        if (!isConfig) {
          return
        }
        config = null
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
          runtimeModule: macroRuntimeModule,
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
        const result = compileCatalogModule(catalogArtifactConfig(cfg), cleanId, {
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
