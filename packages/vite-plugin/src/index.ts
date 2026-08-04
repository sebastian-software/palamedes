/**
 * @palamedes/vite-plugin
 *
 * Vite plugin for Palamedes using OXC-based macro transformation.
 * No Babel required!
 */

import { createHash } from "node:crypto"
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
  renderCatalogModule,
  type CatalogArtifactConfig,
} from "@palamedes/core-node"
import { createMissingErrorMessage, transformPalamedesMacros } from "@palamedes/transform"
import {
  PALAMEDES_MACRO_PACKAGES,
  mdxFrameworkFor,
  resolveMacroRuntimeModule,
  type PalamedesFramework,
} from "@palamedes/transform"

const PO_FILE_REGEX = /(\.po|\?palamedes)$/
const MDX_FILE_REGEX = /\.mdx$/i
const VIRTUAL_MACRO_ERROR_PREFIX = "\0palamedes:macro-error:"
const VIRTUAL_MESSAGES_PREFIX = "virtual:palamedes-messages/"
const RESOLVED_MESSAGES_PREFIX = "\0palamedes:messages/"
const BARE_MESSAGES_PREFIX = "#pmds/"
const SPLIT_MANIFEST_NAME = "palamedes-split-manifest.json"
const RENDERED_CATALOG_IMPORT =
  'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";'
const RENDERED_CATALOG_DEFAULT_EXPORT = "export default { messages };"

/*
 * Rewrite the native renderer's module source into a dependency-free message
 * asset for import-map delivery: no imports (the aggregator re-brands on
 * receive), plus a `locale` export so the aggregator learns which locale the
 * import map delivered. The exact-string operations are deliberately strict —
 * if the native output shape changes, emitting fails loudly instead of
 * shipping broken assets. The shape is pinned by @palamedes/transform's
 * catalogLoader tests.
 */
function bareMessageAsset(rendered: string, locale: string): string {
  if (
    !rendered.startsWith(RENDERED_CATALOG_IMPORT) ||
    !rendered.includes("__palamedesDefineCompiledCatalog(") ||
    !rendered.trimEnd().endsWith(RENDERED_CATALOG_DEFAULT_EXPORT)
  ) {
    throw new Error(
      "Palamedes graph splitting: the native catalog module shape changed; cannot derive a bare message asset."
    )
  }
  const body = rendered
    .slice(RENDERED_CATALOG_IMPORT.length)
    .replace("__palamedesDefineCompiledCatalog(", "(")
  const withoutDefault = body.slice(0, body.lastIndexOf(RENDERED_CATALOG_DEFAULT_EXPORT))
  return `export const locale=${JSON.stringify(locale)};${withoutDefault}`
}
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
   * UI framework this app compiles for. Selects the component contract for
   * generated MDX modules. Use `"none"` for a project that is neither React
   * nor Solid.
   * @default "react"
   */
  framework?: PalamedesFramework

  /**
   * Advanced override for the module the macro transform imports. Generated
   * MDX modules are not affected;
   * configure those through `mdx.runtimeModule`.
   * @default "@palamedes/runtime"
   */
  runtimeModule?: string

  /**
   * Preserve authored source messages as browser/runtime fallbacks.
   * Defaults to `true` during `vite serve` and `false` during `vite build`.
   */
  keepSourceFallbacks?: boolean

  /**
   * Override MDX analysis options from the Palamedes config, or disable MDX.
   * @default configuration `mdx` values with React framework defaults
   */
  mdx?: PalamedesMdxConfig | false

  /**
   * EXPERIMENTAL: emit one generated message sidecar module per transformed
   * source file, containing only the compiled messages that file references,
   * and append a static import of it to the transformed output. Messages then
   * travel through the bundler's module graph with the code that uses them,
   * so route-level code splitting splits messages without any route
   * configuration. Requires the application to install its client instance
   * with `setClientI18n` instead of importing `.po` catalogs eagerly.
   *
   * The object form selects how the locale dimension binds:
   *
   * - `localeBinding: "embed"` (default) — every sidecar embeds all locales;
   *   simplest, works everywhere, ships `locales ×` the route's messages.
   * - `localeBinding: "import-map"` — production client builds import each
   *   sidecar through a bare `#pmds/<key>` specifier and the build emits one
   *   dependency-free message asset per (sidecar × locale) plus one import
   *   map per locale and a `palamedes-split-manifest.json`. The server must
   *   inject the active locale's import map into the HTML before any module
   *   loads; the browser then downloads only the active locale's messages,
   *   and translation-only deploys change message assets and import maps
   *   while code chunks keep their hashes. Locale switching requires a
   *   document navigation. Dev servers and SSR builds keep the embedded
   *   form.
   * @default false
   */
  experimentalGraphSplitting?: boolean | { localeBinding?: "embed" | "import-map" }
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
    framework = "react",
    runtimeModule,
    keepSourceFallbacks,
    mdx: mdxOverride,
    experimentalGraphSplitting = false,
    ...configLoaderOptions
  } = options
  const macroRuntimeModule = resolveMacroRuntimeModule(runtimeModule)
  const graphSplitting = experimentalGraphSplitting !== false
  const importMapBinding =
    typeof experimentalGraphSplitting === "object" &&
    experimentalGraphSplitting.localeBinding === "import-map"
  let resolvedKeepSourceFallbacks = keepSourceFallbacks ?? false
  let stripNonEssentialProps = true
  let isBuildCommand = false
  let resolvedBase = "/"

  // Initialize lazily
  let config: LoadedPalamedesConfig | null = null
  let filter: ReturnType<typeof createFilter> | null = null
  let mdxFilter: ReturnType<typeof createFilter> | null = null
  let macroIds: Set<string> | null = null
  const mdxModuleIds = new Set<string>()

  /*
   * Message sidecar registry for experimental graph splitting, keyed by a
   * short hash of the source module id. Entries are written when a module is
   * transformed and read when the bundler loads the sidecar it imports, so
   * population always precedes the read within one build. Entries are
   * overwritten on re-transform and deliberately never cleared: a stale entry
   * for an untouched module keeps dev-server requests working across config
   * reloads.
   */
  const sidecarModules = new Map<string, { sourceId: string; compiledIds: string[] }>()

  function sidecarKey(sourceId: string): string {
    return createHash("sha256").update(sourceId).digest("hex").slice(0, 12)
  }

  /*
   * Register a module's message set and append the import of its generated
   * sidecar. Appending keeps native source maps valid; imports hoist anyway.
   * Both the macro transform and MDX compilation route through here, so MDX
   * content splits exactly like `t`/`Trans` call sites do.
   */
  function withSidecarImport(code: string, sourceId: string, compiledIds: string[]): string {
    if (!graphSplitting || compiledIds.length === 0) {
      return code
    }
    const key = sidecarKey(sourceId)
    sidecarModules.set(key, { sourceId, compiledIds })
    return `${code}\nimport "${VIRTUAL_MESSAGES_PREFIX}${key}";\n`
  }

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
    const resolved = {
      ...(mdxFrameworkFor(framework) ? { framework: mdxFrameworkFor(framework) } : {}),
      ...cfg.mdx,
      ...mdxOverride,
    }
    if (resolved.runtimeModule) {
      return resolved
    }

    return {
      ...resolved,
      runtimeModule: resolveMacroRuntimeModule(),
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
        const mdx = {
          ...resolveMdxOptions(cfg),
          keepSourceFallbacks: resolvedKeepSourceFallbacks,
        }
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
        const mdx = {
          ...resolveMdxOptions(cfg),
          keepSourceFallbacks: resolvedKeepSourceFallbacks,
        }
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
          code: withSidecarImport(result.code, cleanId, result.compiledIds),
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

    config(viteConfig, env) {
      resolvedKeepSourceFallbacks = keepSourceFallbacks ?? env.command === "serve"
      stripNonEssentialProps = env.command === "build"
      isBuildCommand = env.command === "build"
      resolvedBase = typeof viteConfig.base === "string" ? viteConfig.base : "/"
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
          keepSourceFallbacks: resolvedKeepSourceFallbacks,
          stripNonEssentialProps,
        })

        if (!result.hasChanged) {
          return null
        }

        return {
          code: withSidecarImport(result.code, cleanId, result.compiledIds),
          map: result.map as any,
        }
      } catch (error) {
        const err = error as Error
        this.error(`Palamedes transform error in ${cleanId}: ${err.message}`)
      }
    },
  })

  // Plugin 4b: message sidecar modules for experimental graph splitting.
  // Per message-bearing source file, one per-locale module rendered by the
  // native catalog-module renderer (ADR-022: the single generator, so split
  // artifacts stay on the branded parser-free compiled ABI) plus one
  // aggregator that registers the branded exports with the runtime. The
  // bundler then distributes messages along the module graph.
  if (graphSplitting) {
    type SidecarEntry = { sourceId: string; compiledIds: string[] }

    function compileSidecarLocale(
      cfg: LoadedPalamedesConfig,
      entry: SidecarEntry,
      locale: string,
      context: { addWatchFile?: (file: string) => void; warn?: (message: string) => void }
    ): Record<string, string> | null {
      const catalogs = cfg.catalogs.filter((catalog) =>
        catalogMatchesSource(cfg, catalog, entry.sourceId)
      )
      if (catalogs.length === 0) {
        context.warn?.(
          `Palamedes graph splitting: ${entry.sourceId} uses messages but is not included in any configured catalog; its messages will be missing at runtime.`
        )
        return null
      }

      const selected: Record<string, string> = {}
      for (const catalog of catalogs) {
        const artifactConfig = catalogArtifactConfig(cfg, [catalog])
        const resourcePath = catalogResourcePath(cfg, catalog, locale)
        const result = compileCatalogArtifactSelected(
          artifactConfig,
          resourcePath,
          entry.compiledIds
        )
        result.watchFiles.forEach((file: string) => context.addWatchFile?.(file))
        if (result.missing.length > 0 && context.warn) {
          const message =
            `${createMissingErrorMessage(locale, result.missing)}\n\n` +
            `Referenced by ${entry.sourceId}.`
          if (failOnMissing) {
            throw new Error(message)
          }
          context.warn(message)
        }
        Object.assign(selected, result.messages)
      }
      return selected
    }

    plugins.push({
      name: "palamedes:message-sidecars",

      config() {
        if (!importMapBinding) {
          return
        }
        // Bare #pmds/ specifiers stay external in client builds; the emitted
        // per-locale import map resolves them in the browser. SSR aggregators
        // never emit these specifiers, so the external filter cannot match
        // there.
        return {
          build: {
            rollupOptions: {
              external: (id: string) => id.startsWith(BARE_MESSAGES_PREFIX),
            },
          },
        }
      },

      resolveId(id) {
        if (id.startsWith(VIRTUAL_MESSAGES_PREFIX)) {
          return `${RESOLVED_MESSAGES_PREFIX}${id.slice(VIRTUAL_MESSAGES_PREFIX.length)}`
        }
      },

      /*
       * Sidecars are generated modules: they carry compiled messages but have
       * no import edge to the catalog they came from, so the dev server does
       * not know a `.po` edit concerns them and translated UI would keep
       * showing stale messages until a restart. Invalidate them here instead.
       *
       * Every sidecar of a changed catalog is invalidated rather than only
       * those whose ids actually moved: deciding that needs a before/after
       * diff of the catalog, and re-rendering a handful of small generated
       * modules is cheaper than keeping that state correct.
       */
      async load(id, loadOptions) {
        if (!id.startsWith(RESOLVED_MESSAGES_PREFIX)) {
          return null
        }

        const [key, locale] = id.slice(RESOLVED_MESSAGES_PREFIX.length).split("/", 2)
        const entry = key === undefined ? undefined : sidecarModules.get(key)
        if (!entry || key === undefined) {
          this.error(
            `Palamedes message sidecar "${key}" was requested before its source module was transformed. ` +
              "This indicates a plugin ordering problem; please report it."
          )
        }

        const cfg = await getConfigLazy()
        this.addWatchFile(cfg.configPath)
        const locales = cfg.locales

        if (locale === undefined) {
          const ssr =
            loadOptions?.ssr === true ||
            (this as { environment?: { name?: string } }).environment?.name === "ssr"

          if (importMapBinding && isBuildCommand && !ssr) {
            // Import-map binding: the client aggregator imports one
            // locale-neutral bare specifier. The per-locale import map decides
            // which emitted message asset answers it, so only the active
            // locale downloads, and the asset name's hash never appears in
            // this module or its importers. The asset ships unbranded
            // (dependency-free); branding happens on receive.
            const boundCode =
              `import { locale as l, messages as m } from "${BARE_MESSAGES_PREFIX}${key}";\n` +
              `import { defineCompiledCatalog } from "@palamedes/core/compiled";\n` +
              `import { registerMessages } from "@palamedes/runtime";\n` +
              `registerMessages({ [l]: defineCompiledCatalog(m) });\n`
            return { code: boundCode, map: null, moduleSideEffects: true }
          }

          // Embedded binding: import each branded per-locale module and
          // register it.
          const imports = locales
            .map(
              (localeName, index) =>
                `import { messages as m${index} } from "${VIRTUAL_MESSAGES_PREFIX}${key}/${localeName}";`
            )
            .join("\n")
          const registration = locales
            .map((localeName, index) => `${JSON.stringify(localeName)}: m${index}`)
            .join(", ")
          const code =
            `${imports}\n` +
            `import { registerMessages } from "@palamedes/runtime";\n` +
            `registerMessages({ ${registration} });\n`
          return { code, map: null, moduleSideEffects: true }
        }

        if (!locales.includes(locale)) {
          this.error(`Palamedes message sidecar "${key}" requested unknown locale "${locale}".`)
        }

        let selected: Record<string, string> | null = null
        try {
          selected = compileSidecarLocale(cfg, entry, locale, {
            addWatchFile: (file) => this.addWatchFile(file),
            warn: (message) => this.warn(message),
          })
        } catch (error) {
          this.error(error instanceof Error ? error.message : String(error))
        }

        return { code: renderCatalogModule(selected ?? {}), map: null }
      },

      async generateBundle(_options, bundle) {
        const environmentName = (this as { environment?: { name?: string } }).environment?.name
        if (!importMapBinding || environmentName === "ssr" || sidecarModules.size === 0) {
          return
        }

        const cfg = await getConfigLazy()
        const locales = cfg.locales
        const importMaps = new Map<string, Record<string, string>>(
          locales.map((locale) => [locale, {}])
        )

        // Sorted for determinism: sidecarModules fills in transform order,
        // which varies between builds; unsorted emission would re-hash the
        // import maps of untouched locales on every build.
        const sortedSidecars = [...sidecarModules.entries()].sort(([a], [b]) => a.localeCompare(b))
        for (const [key, entry] of sortedSidecars) {
          for (const locale of locales) {
            const selected = compileSidecarLocale(cfg, entry, locale, {})
            const asset = bareMessageAsset(renderCatalogModule(selected ?? {}), locale)
            const contentHash = createHash("sha256").update(asset).digest("hex").slice(0, 8)
            const fileName = `assets/palamedes-m-${key}.${locale}-${contentHash}.js`
            this.emitFile({ type: "asset", fileName, source: asset })
            importMaps.get(locale)![`${BARE_MESSAGES_PREFIX}${key}`] = `${resolvedBase}${fileName}`
          }
        }

        // Which chunk imports which bare message specifier, so servers can
        // emit modulepreload hints for the mapped assets of the chunks they
        // are about to serve and message assets load in parallel with the
        // code instead of one waterfall step behind it.
        const chunkImports: Record<string, string[]> = {}
        for (const fileName of Object.keys(bundle).sort()) {
          const output = bundle[fileName]
          if (!output || output.type !== "chunk") {
            continue
          }
          const bareImports = output.imports
            .filter((imported) => imported.startsWith(BARE_MESSAGES_PREFIX))
            .sort()
          if (bareImports.length > 0) {
            chunkImports[fileName] = bareImports
          }
        }

        const manifest: {
          locales: string[]
          importMaps: Record<string, string>
          chunkImports: Record<string, string[]>
        } = {
          locales,
          importMaps: {},
          chunkImports,
        }
        for (const [locale, imports] of importMaps) {
          const source = JSON.stringify({ imports })
          const contentHash = createHash("sha256").update(source).digest("hex").slice(0, 8)
          const fileName = `assets/palamedes-importmap.${locale}-${contentHash}.json`
          this.emitFile({ type: "asset", fileName, source })
          manifest.importMaps[locale] = fileName
        }
        this.emitFile({
          type: "asset",
          fileName: SPLIT_MANIFEST_NAME,
          source: JSON.stringify(manifest, null, 2),
        })
      },
    })
  }

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
