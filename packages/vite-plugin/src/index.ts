/**
 * @palamedes/vite-plugin
 *
 * Vite plugin for Palamedes using OXC-based macro transformation.
 * No Babel required!
 */

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import * as viteModule from "vite";
import type { Plugin, FilterPattern } from "vite";
import { createFilter, version as viteVersion } from "vite";
import {
  loadPalamedesConfig,
  catalogMatchesSource,
  catalogResourcePath,
  getConfigDependencies,
  type PalamedesCatalogConfig,
  type LoadedPalamedesConfig,
  type PalamedesMdxConfig,
} from "@palamedes/config";
import {
  analyzeMdxNative,
  compileCatalogArtifactSelectedAsync,
  compileCatalogModuleAsync,
  renderCatalogModule,
  type CatalogArtifactConfig,
} from "@palamedes/core-node";
import { createMissingErrorMessage, transformPalamedesMacros } from "@palamedes/transform";
import {
  PALAMEDES_BUNDLER_TRANSFORM_INCLUDE,
  PALAMEDES_MACRO_PACKAGES,
  mdxFrameworkFor,
  resolveMacroRuntimeModule,
  type PalamedesFramework,
} from "@palamedes/transform";

const PO_FILE_REGEX = /(\.po|\.fcl|\?palamedes)$/;
const MDX_FILE_REGEX = /\.mdx$/i;
const VIRTUAL_MACRO_ERROR_PREFIX = "\0palamedes:macro-error:";
const VIRTUAL_MESSAGES_PREFIX = "virtual:palamedes-messages/";
const VIRTUAL_SERVER_CATALOGS = "virtual:palamedes/server-catalogs";
const RESOLVED_SERVER_CATALOGS = "\0palamedes:server-catalogs";
const RESOLVED_MESSAGES_PREFIX = "\0palamedes:messages/";
const BARE_MESSAGES_PREFIX = "#pmds/";
const SPLIT_MANIFEST_NAME = "palamedes-split-manifest.json";
const RENDERED_CATALOG_IMPORT =
  'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";';
const RENDERED_CATALOG_DEFAULT_EXPORT = "export default { messages };";

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
      "Palamedes graph splitting: the native catalog module shape changed; cannot derive a bare message asset.",
    );
  }
  const body = rendered
    .slice(RENDERED_CATALOG_IMPORT.length)
    .replace("__palamedesDefineCompiledCatalog(", "(");
  const withoutDefault = body.slice(0, body.lastIndexOf(RENDERED_CATALOG_DEFAULT_EXPORT));
  return `export const locale=${JSON.stringify(locale)};${withoutDefault}`;
}
const MISSING_CONFIG_ERROR_PREFIX = "Could not find a Palamedes config.";
const VITE_MAJOR = Number.parseInt(viteVersion.split(".")[0] ?? "0", 10);
// `moduleType` and Rollup's `moduleTypes` bridge require Vite's Rolldown-based
// pipeline. The official rolldown-vite alias exposes this on the Vite 7 line,
// so detect the optional export instead of using only Vite's major version.
// Reflect.get keeps the published bundle compatible with Vite versions that
// do not provide a named `rolldownVersion` export.
function viteSupportsReactMdxModuleType(): boolean {
  return VITE_MAJOR >= 8 || typeof Reflect.get(viteModule, "rolldownVersion") === "string";
}

const REACT_MDX_VITE_REQUIREMENT =
  'Palamedes React MDX compilation requires Vite 8 or rolldown-vite because Rollup-based Vite cannot parse generated JSX from .mdx files. Upgrade Vite, use rolldown-vite, set `mdx: { framework: "solid" }` for Solid, or disable first-class MDX with `mdx: false`.';

type EnvironmentAwarePluginContext = {
  environment?: {
    name?: string;
    config?: { consumer?: string };
  };
};

const ROUTE_FACADE_VERSION = "v2";

type RouteFacadeChunk = {
  code: string;
  fileName: string;
  exports: readonly string[];
};

function routeFacadeSource(relative: string, exports: readonly string[]): string {
  const renderedExports = exports
    .map((name, index) => {
      const value = `__export${index}`;
      const failedExport =
        name === "default"
          ? "function(){throw failure}"
          : name === "meta" || name === "links"
            ? "()=>[]"
            : "undefined";
      return `const ${value}=failure?${failedExport}:route[${JSON.stringify(name)}];export{${value} as ${name}};`;
    })
    .join("\n");
  return `/*palamedes-route-facade:${ROUTE_FACADE_VERSION}*/let route,failure;try{route=await import(${JSON.stringify(relative)})}catch(error){if(!globalThis[Symbol.for("palamedes.document-catalogs-ready")])throw error;failure=error}\n${renderedExports}`;
}

function routeAssetSource(code: string): string {
  // The original chunk is moved to a content-addressed asset without its
  // Rollup chunk map. Do not leave a sourceMappingURL pointing at the old
  // facade filename.
  return code.replace(/\r?\n?\/\/[#@]\s*sourceMappingURL=.*$/u, "");
}

function createRouteFacade(chunk: RouteFacadeChunk): {
  assetFileName: string;
  assetSource: string;
  facadeSource: string;
} {
  const hash = createHash("sha256").update(chunk.code).digest("hex").slice(0, 12);
  const assetFileName = `${path.posix.dirname(chunk.fileName)}/palamedes-route-${hash}.js`;
  const relative = `./${path.posix.basename(assetFileName)}`;
  const facadeSource = routeFacadeSource(relative, chunk.exports);
  return { assetFileName, assetSource: routeAssetSource(chunk.code), facadeSource };
}

function isServerEnvironment(context: unknown, ssr = false, legacyBuildSsr = false): boolean {
  const environment = (context as EnvironmentAwarePluginContext).environment;
  // Vite <=5 has no environment context, so use the root build.ssr flag only
  // for that legacy shape. Modern Vite environments can include both clients
  // and servers in one build.
  return (
    ssr ||
    environment?.config?.consumer === "server" ||
    environment?.name === "ssr" ||
    (environment === undefined && legacyBuildSsr)
  );
}

function assertImportMapBase(base: string): void {
  if (base.startsWith("/") || URL.canParse(base)) {
    return;
  }

  throw new Error(
    `Palamedes graph splitting with localeBinding: "import-map" requires Vite's resolved base to be root-relative (for example "/app/") or an absolute URL. Relative base ${JSON.stringify(base)} resolves import-map entries against each document URL and breaks on nested routes. Set Vite base to "/" or an absolute deployment path/URL, or use localeBinding: "embed".`,
  );
}

function stripQuery(id: string): string {
  return id.split("?")[0] ?? id;
}

function catalogLocaleForResource(config: LoadedPalamedesConfig, resourcePath: string): string {
  const canonicalResourcePath = canonicalPath(resourcePath);
  return (
    config.locales.find((locale) =>
      config.catalogs.some(
        (catalog) =>
          canonicalPath(catalogResourcePath(config, catalog, locale)) === canonicalResourcePath,
      ),
    ) ?? path.basename(resourcePath, path.extname(resourcePath))
  );
}

function canonicalPath(value: string): string {
  const pathImplementation = isWindowsPath(value) ? path.win32 : path;
  try {
    return realpathSync.native(value);
  } catch {
    return pathImplementation.resolve(value);
  }
}

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function canonicalRelativePath(rootDir: string, sourceId: string): string {
  const canonicalRootDir = canonicalPath(rootDir);
  const canonicalSourceId = canonicalPath(sourceId);
  const usesWindowsPaths = isWindowsPath(canonicalRootDir) || isWindowsPath(canonicalSourceId);
  const pathImplementation = usesWindowsPaths ? path.win32 : path;

  // Windows returns a traversal path for UNC locations on the same server but
  // different shares. Compare roots before deriving a relative identity so a
  // share boundary cannot make the sidecar key depend on checkout depth.
  if (
    usesWindowsPaths &&
    path.win32.parse(canonicalRootDir).root.toLowerCase() !==
      path.win32.parse(canonicalSourceId).root.toLowerCase()
  ) {
    throw new Error(
      `Palamedes graph splitting cannot derive a reproducible sidecar key for ${sourceId}: it is on a different filesystem volume than ${rootDir}.`,
    );
  }
  const relativePath = pathImplementation.relative(canonicalRootDir, canonicalSourceId);

  // There is no checkout-independent relative identity across filesystem
  // volumes, so refusing graph splitting is safer than baking a machine path
  // into sidecar keys and emitted chunk content.
  if (pathImplementation.isAbsolute(relativePath)) {
    throw new Error(
      `Palamedes graph splitting cannot derive a reproducible sidecar key for ${sourceId}: it is on a different filesystem volume than ${rootDir}.`,
    );
  }

  return (relativePath || ".").replaceAll("\\", "/");
}

function catalogArtifactConfig(
  cfg: LoadedPalamedesConfig,
  catalogs: PalamedesCatalogConfig[] = cfg.catalogs,
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
  };
}

export type PalamedesPluginOptions = {
  /**
   * Pattern to include files for transformation.
   * @default /\.([cm]?[jt]s|[jt]sx)$/
   */
  include?: FilterPattern;

  /**
   * Pattern to exclude files from transformation.
   * @default /node_modules/
   */
  exclude?: FilterPattern;

  /**
   * Enable .po file compilation loader.
   * @default true
   */
  enablePoLoader?: boolean;

  /**
   * Path to a Palamedes config file.
   * If not provided, searches for config automatically.
   */
  configPath?: string;

  /**
   * Current working directory for config resolution.
   */
  cwd?: string;

  /**
   * Skip validation of the config file.
   */
  skipValidation?: boolean;

  /**
   * If true, fail compilation on missing translations.
   * @default false
   */
  failOnMissing?: boolean;

  /**
   * If true, fail compilation on message compilation errors.
   * @deprecated Palamedes v2 always rejects invalid and unsupported ICU;
   * remove this option.
   */
  failOnCompileError?: boolean;

  /**
   * UI framework this app compiles for. Selects the component contract for
   * generated MDX modules. Use `"none"` for a project that is neither React
   * nor Solid.
   * @default "react"
   */
  framework?: PalamedesFramework;

  /**
   * Advanced override for the module the macro transform imports. Generated
   * MDX modules are not affected;
   * configure those through `mdx.runtimeModule`.
   * @default "@palamedes/runtime"
   */
  runtimeModule?: string;

  /**
   * Preserve authored source messages as diagnostic metadata only.
   * Defaults to `false` in every environment. Set to `true` to retain
   * authored source text for diagnostics.
   * V2 runtime misses throw; this metadata never provides replacement output.
   */
  keepSourceFallbacks?: boolean;

  /**
   * Override MDX analysis options from the Palamedes config, or disable MDX.
   * @default configuration `mdx` values with React framework defaults
   */
  mdx?: PalamedesMdxConfig | false;

  /**
   * @deprecated Compiled graph delivery is automatic in every environment.
   * Legacy enabled forms use active-locale delivery. `false` is rejected.
   */
  experimentalGraphSplitting?: boolean | { localeBinding?: "embed" | "import-map" };
};

/**
 * Create the Palamedes Vite plugin
 */
export function palamedes(options: PalamedesPluginOptions = {}): Plugin[] {
  const {
    include = PALAMEDES_BUNDLER_TRANSFORM_INCLUDE,
    exclude = /node_modules/,
    enablePoLoader = true,
    failOnMissing = false,
    failOnCompileError,
    framework = "react",
    runtimeModule,
    keepSourceFallbacks,
    mdx: mdxOverride,
    experimentalGraphSplitting,
    ...configLoaderOptions
  } = options;
  const macroRuntimeModule = resolveMacroRuntimeModule(runtimeModule);
  if (experimentalGraphSplitting === false) {
    throw new Error(
      "Palamedes v2 delivers compiled catalogs automatically. Remove experimentalGraphSplitting: false.",
    );
  }
  const graphSplitting = true;
  const importMapBinding = true;
  let resolvedKeepSourceFallbacks = keepSourceFallbacks ?? false;
  let stripNonEssentialProps = true;
  let isBuildCommand = false;
  let resolvedBase = "/";
  let legacyBuildSsr = false;

  // Initialize lazily
  let config: LoadedPalamedesConfig | null = null;
  let configDependencies = new Set<string>();
  let filter: ReturnType<typeof createFilter> | null = null;
  let mdxFilter: ReturnType<typeof createFilter> | null = null;
  let macroIds: Set<string> | null = null;
  const mdxModuleIds = new Set<string>();

  /*
   * Message sidecar registry for experimental graph splitting, keyed by a
   * short hash of the canonical source path relative to the Palamedes root.
   * Entries are written when a module is transformed and read when the bundler
   * loads the sidecar it imports, so population always precedes the read
   * within one build. Entries are overwritten on re-transform and deliberately
   * never cleared: a stale entry for an untouched module keeps dev-server
   * requests working across config reloads.
   */
  const sidecarModules = new Map<string, { sourceId: string; compiledIds: string[] }>();

  async function sidecarKey(sourceId: string): Promise<string> {
    const cfg = await getConfigLazy();
    const modulePath = canonicalRelativePath(cfg.rootDir, sourceId);
    return createHash("sha256").update(modulePath).digest("hex").slice(0, 12);
  }

  /*
   * Register a module's message set and append the import of its generated
   * sidecar. Appending keeps native source maps valid; imports hoist anyway.
   * Both the macro transform and MDX compilation route through here, so MDX
   * content splits exactly like `t`/`Trans` call sites do.
   */
  function withSidecarImport(
    code: string,
    sourceId: string,
    compiledIds: string[],
  ): string | Promise<string> {
    if (!graphSplitting || compiledIds.length === 0) {
      return code;
    }
    return sidecarKey(sourceId).then((key) => {
      sidecarModules.set(key, { sourceId, compiledIds });
      return `${code}\nimport "${VIRTUAL_MESSAGES_PREFIX}${key}";\n`;
    });
  }

  function transformErrorMessage(sourceId: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return `Palamedes transform error in ${sourceId}: ${message}`;
  }

  async function getConfigLazy() {
    if (!config) {
      config = await loadPalamedesConfig(configLoaderOptions);
      configDependencies = new Set(getConfigDependencies(config).map(canonicalPath));
      macroIds = new Set(PALAMEDES_MACRO_PACKAGES);
    }
    return config;
  }

  function isConfigChange(id: string): boolean {
    return configDependencies.has(canonicalPath(stripQuery(id)));
  }

  function addConfigWatchFiles(
    cfg: LoadedPalamedesConfig,
    addWatchFile: (file: string) => void,
  ): void {
    getConfigDependencies(cfg).forEach(addWatchFile);
  }

  function resetConfig(): void {
    config = null;
  }

  function resetConfigOnChange(id: string): void {
    if (isConfigChange(id)) {
      resetConfig();
    }
  }

  function getFilterLazy() {
    if (!filter) {
      filter = createFilter(include, exclude);
    }
    return filter;
  }

  function getMdxFilterLazy() {
    if (!mdxFilter) {
      mdxFilter = createFilter(undefined, exclude);
    }
    return mdxFilter;
  }

  function matchesTransformFilter(id: string): boolean {
    if (mdxOverride !== false && MDX_FILE_REGEX.test(id)) {
      return getMdxFilterLazy()(id);
    }
    return getFilterLazy()(id);
  }

  function resolveMdxOptions(cfg: LoadedPalamedesConfig): PalamedesMdxConfig {
    const resolved = {
      ...(mdxFrameworkFor(framework) ? { framework: mdxFrameworkFor(framework) } : {}),
      ...cfg.mdx,
      ...mdxOverride,
    };
    if (resolved.runtimeModule) {
      return resolved;
    }

    return {
      ...resolved,
      runtimeModule: resolveMacroRuntimeModule(),
    };
  }

  function isMissingAutoConfig(error: unknown): boolean {
    return (
      configLoaderOptions.configPath === undefined &&
      error instanceof Error &&
      error.message.startsWith(MISSING_CONFIG_ERROR_PREFIX)
    );
  }

  async function validateMdxTranslations(
    cfg: LoadedPalamedesConfig,
    id: string,
    compiledIds: string[],
    addWatchFile: (file: string) => void,
  ): Promise<void> {
    if (!failOnMissing || compiledIds.length === 0) {
      return;
    }

    const catalogs = cfg.catalogs.filter((catalog) => catalogMatchesSource(cfg, catalog, id));
    if (catalogs.length === 0) {
      throw new Error(
        `Cannot validate MDX translations for ${id}: the file is not included in a configured catalog.`,
      );
    }

    for (const catalog of catalogs) {
      const artifactConfig = catalogArtifactConfig(cfg, [catalog]);
      for (const locale of cfg.locales) {
        if (locale === cfg.sourceLocale || locale === cfg.pseudoLocale) {
          continue;
        }
        const resourcePath = catalogResourcePath(cfg, catalog, locale);
        const result = await compileCatalogArtifactSelectedAsync(
          artifactConfig,
          resourcePath,
          compiledIds,
        );
        result.watchFiles.forEach(addWatchFile);
        if (result.missing.length > 0) {
          throw new Error(
            `${createMissingErrorMessage(locale, result.missing)}\n\n` +
              "You see this error because `failOnMissing=true` in Vite plugin configuration.",
          );
        }
      }
    }
  }

  const plugins: Plugin[] = [];

  // Plugin 1: Report macro resolution errors
  plugins.push({
    name: "palamedes:report-macro-error",
    enforce: "pre" as const,

    resolveId(id) {
      const ids = macroIds ?? new Set(PALAMEDES_MACRO_PACKAGES);
      if (ids.has(id)) {
        return `${VIRTUAL_MACRO_ERROR_PREFIX}${id}`;
      }
    },

    resolveDynamicImport(id) {
      const ids = macroIds ?? new Set(PALAMEDES_MACRO_PACKAGES);
      if (ids.has(id as string)) {
        throw new Error(
          `The macro you imported from "${id}" cannot be dynamically imported.\n` +
            `Palamedes macros must be statically imported.`,
        );
      }
    },

    load(id) {
      if (!id.startsWith(VIRTUAL_MACRO_ERROR_PREFIX)) {
        return null;
      }

      const macroId = id.slice(VIRTUAL_MACRO_ERROR_PREFIX.length);
      throw new Error(
        `The macro you imported from "${macroId}" is being executed outside the context of compilation.\n` +
          `This indicates that @palamedes/vite-plugin is not transforming the file.\n` +
          `Please ensure the plugin is configured correctly in your vite.config.ts`,
      );
    },
  });

  // Plugin 2: Compile MDX before framework JSX transforms.
  if (mdxOverride !== false) {
    plugins.push({
      name: "palamedes:mdx",
      enforce: "pre" as const,

      async config() {
        let cfg: LoadedPalamedesConfig;
        try {
          cfg = await getConfigLazy();
        } catch (error) {
          if (isMissingAutoConfig(error)) {
            return;
          }
          throw error;
        }
        const mdx = {
          ...resolveMdxOptions(cfg),
          keepSourceFallbacks: resolvedKeepSourceFallbacks,
        };
        if ((mdx.framework ?? "react") !== "react" || !viteSupportsReactMdxModuleType()) {
          return;
        }
        return {
          build: {
            rollupOptions: {
              moduleTypes: {
                ".mdx": "jsx",
              },
            },
          },
        };
      },

      buildStart() {
        mdxModuleIds.clear();
      },

      watchChange(id, change) {
        const cleanId = stripQuery(id);
        if (change.event === "delete") {
          mdxModuleIds.delete(cleanId);
        }
      },

      async transform(source, id) {
        const cleanId = stripQuery(id);
        if (!MDX_FILE_REGEX.test(cleanId) || !matchesTransformFilter(cleanId)) {
          return null;
        }
        if (VITE_MAJOR < 7) {
          this.error(
            "Palamedes MDX compilation requires Vite 7 or newer. Disable it with `mdx: false` when using an older Vite release.",
          );
        }
        const cfg = await getConfigLazy();
        const mdx = {
          ...resolveMdxOptions(cfg),
          keepSourceFallbacks: resolvedKeepSourceFallbacks,
        };
        if ((mdx.framework ?? "react") === "react" && !viteSupportsReactMdxModuleType()) {
          this.error(REACT_MDX_VITE_REQUIREMENT);
        }
        const result = analyzeMdxNative(source, cleanId, mdx);
        mdxModuleIds.add(cleanId);
        addConfigWatchFiles(cfg, (file) => this.addWatchFile(file));
        await validateMdxTranslations(cfg, cleanId, result.compiledIds, (file) =>
          this.addWatchFile(file),
        );

        if (result.diagnostics.length > 0 || !result.code) {
          const details = result.diagnostics
            .map(
              (diagnostic) =>
                `${cleanId}:${diagnostic.primary.line}:${diagnostic.primary.column}: ${diagnostic.message} (${diagnostic.code})`,
            )
            .join("\n");
          const primary = result.diagnostics[0]?.primary;
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
          });
        }

        let transformedCode: string;
        try {
          transformedCode = await withSidecarImport(result.code, cleanId, result.compiledIds);
        } catch (error) {
          this.error(transformErrorMessage(cleanId, error));
        }

        return {
          code: transformedCode,
          map: result.map,
          ...((mdx.framework ?? "react") === "react" ? { moduleType: "jsx" as const } : {}),
        };
      },

      handleHotUpdate(context) {
        const cleanId = stripQuery(context.file);
        if (!isConfigChange(cleanId)) {
          return;
        }
        resetConfig();
        const modules = [...mdxModuleIds]
          .map((id) => context.server.moduleGraph.getModuleById(id))
          .filter((module): module is NonNullable<typeof module> => module !== undefined);
        modules.forEach((module) => context.server.moduleGraph.invalidateModule(module));
        return modules;
      },
    });
  }

  // Plugin 3: Transform macros
  plugins.push({
    name: "palamedes:transform",
    enforce: "pre" as const,

    // Config invalidation belongs on the transform plugin because it is the
    // only Palamedes plugin present for every supported configuration. In
    // particular, graph splitting can intentionally disable both MDX and the
    // eager PO loader while its sidecars still read this shared config.
    buildStart() {
      resetConfig();
    },

    watchChange(id) {
      resetConfigOnChange(id);
    },

    config(viteConfig, env) {
      // A catalog chunk can be unavailable briefly during a staggered deploy or
      // while an import-map fragment is still loading. Keep the authored
      // message in first-party output by default so that case remains readable
      // instead of exposing the opaque compiled id. Consumers that cannot ship
      // source text can opt out explicitly.
      resolvedKeepSourceFallbacks = keepSourceFallbacks ?? false;
      stripNonEssentialProps = env.command === "build";
      isBuildCommand = env.command === "build";
      const ids = new Set(PALAMEDES_MACRO_PACKAGES);
      macroIds = ids;

      // Exclude macro packages from optimization
      // https://github.com/lingui/js-lingui/issues/1464
      if (!viteConfig.optimizeDeps) {
        viteConfig.optimizeDeps = {};
      }
      viteConfig.optimizeDeps.exclude = viteConfig.optimizeDeps.exclude || [];

      for (const macroId of ids) {
        viteConfig.optimizeDeps.exclude.push(macroId);
      }
    },

    // Vite normalizes `base` and applies every plugin's config hook before
    // this lifecycle point. Import maps need that final base so asset URLs
    // retain their separator for non-root and relative deployments.
    configResolved(viteConfig) {
      resolvedBase = viteConfig.base;
      legacyBuildSsr = Boolean(viteConfig.build.ssr);
    },

    transform(code, id) {
      const cleanId = stripQuery(id);

      // Check file extension and filter
      if (!matchesTransformFilter(cleanId)) {
        return null;
      }

      // Quick check: skip if no macro imports
      const ids = macroIds ?? new Set(PALAMEDES_MACRO_PACKAGES);
      const hasAnyMacroImport = [...ids].some((macroId) => code.includes(macroId));
      if (!hasAnyMacroImport) {
        return null;
      }

      try {
        const result = transformPalamedesMacros(code, cleanId, {
          runtimeModule: macroRuntimeModule,
          keepSourceFallbacks: resolvedKeepSourceFallbacks,
          stripNonEssentialProps,
        });

        if (!result.hasChanged) {
          return null;
        }

        const sidecarCode = withSidecarImport(result.code, cleanId, result.compiledIds);
        if (typeof sidecarCode === "string") {
          return {
            code: sidecarCode,
            map: result.map as any,
          };
        }
        return sidecarCode.then(
          (transformedCode) => ({
            code: transformedCode,
            map: result.map as any,
          }),
          (error) => this.error(transformErrorMessage(cleanId, error)),
        );
      } catch (error) {
        this.error(transformErrorMessage(cleanId, error));
      }
    },
  });

  // Plugin 4b: message sidecar modules for experimental graph splitting.
  // Per message-bearing source file, one per-locale module rendered by the
  // native catalog-module renderer (ADR-022: the single generator, so split
  // artifacts stay on the branded parser-free compiled ABI) plus one
  // aggregator that registers the branded exports with the runtime. The
  // bundler then distributes messages along the module graph.
  if (graphSplitting) {
    type SidecarEntry = { sourceId: string; compiledIds: string[] };

    // `warn` is required rather than optional: an omitted channel would
    // silently disable the `failOnMissing` gate below along with the warning,
    // and every caller has a plugin context that provides one.
    async function compileSidecarLocale(
      cfg: LoadedPalamedesConfig,
      entry: SidecarEntry,
      locale: string,
      context: { addWatchFile?: (file: string) => void; warn: (message: string) => void },
    ): Promise<Record<string, string> | null> {
      const catalogs = cfg.catalogs.filter((catalog) =>
        catalogMatchesSource(cfg, catalog, entry.sourceId),
      );
      if (catalogs.length === 0) {
        throw new Error(
          `Palamedes message source ${entry.sourceId} is not included in a configured catalog.`,
        );
      }

      const selected: Record<string, string> = {};
      for (const catalog of catalogs) {
        const artifactConfig = catalogArtifactConfig(cfg, [catalog]);
        const resourcePath = catalogResourcePath(cfg, catalog, locale);
        const result = await compileCatalogArtifactSelectedAsync(
          artifactConfig,
          resourcePath,
          entry.compiledIds,
        );
        result.watchFiles.forEach((file: string) => context.addWatchFile?.(file));
        if (result.missing.length > 0) {
          const message =
            `${createMissingErrorMessage(locale, result.missing)}\n\n` +
            `Referenced by ${entry.sourceId}.`;
          if (failOnMissing) {
            throw new Error(message);
          }
          context.warn(message);
        }
        Object.assign(selected, result.messages);
      }
      return selected;
    }

    plugins.push({
      name: "palamedes:message-sidecars",

      resolveId(id) {
        if (id.startsWith(BARE_MESSAGES_PREFIX)) return { id, external: true };
        if (id.startsWith(VIRTUAL_MESSAGES_PREFIX)) {
          return `${RESOLVED_MESSAGES_PREFIX}${id.slice(VIRTUAL_MESSAGES_PREFIX.length)}`;
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
          return null;
        }

        const [key, locale] = id.slice(RESOLVED_MESSAGES_PREFIX.length).split("/", 2);
        const entry = key === undefined ? undefined : sidecarModules.get(key);
        if (!entry || key === undefined) {
          this.error(
            `Palamedes message sidecar "${key}" was requested before its source module was transformed. ` +
              "This indicates a plugin ordering problem; please report it.",
          );
        }

        const cfg = await getConfigLazy();
        addConfigWatchFiles(cfg, (file) => this.addWatchFile(file));
        const locales = cfg.locales;

        if (locale === undefined) {
          const ssr = isServerEnvironment(this, loadOptions?.ssr === true);

          if (ssr) return { code: "export {};", map: null, moduleSideEffects: false };

          const initialize =
            `import { createI18n } from "@palamedes/core";\n` +
            `import { initializeClientI18n } from "@palamedes/runtime";\n` +
            `const locale = document.documentElement.lang;\n` +
            `if (!${JSON.stringify(locales)}.includes(locale)) throw new Error("Unsupported document catalog locale.");\n` +
            `const i18n = initializeClientI18n(locale, () => createI18n({ locale, timeZone: document.documentElement.dataset.palamedesTimeZone }));\n`;
          if (isBuildCommand) {
            const boundCode =
              `import { locale as l, messages as m } from "${BARE_MESSAGES_PREFIX}${key}";\n` +
              `import { defineCompiledCatalog } from "@palamedes/core/compiled";\n${
                initialize
              }if (l !== locale) throw new Error("Compiled catalog locale does not match the document.");\n` +
              `i18n.load(locale, defineCompiledCatalog(m));\n`;
            return { code: boundCode, map: null, moduleSideEffects: true };
          }

          // Development still loads only the active locale; every locale is a
          // genuine generated-module dependency watched by the Vite server.
          const loaders = locales
            .map(
              (name) =>
                `${JSON.stringify(name)}: () => import(${JSON.stringify(`${VIRTUAL_MESSAGES_PREFIX}${key}/${name}`)})`,
            )
            .join(",");
          return {
            code: `${
              initialize
            }const loaders={${loaders}};\nconst fragment=await loaders[locale]().catch(error=>{const failure=new Error("Palamedes catalog dependency failed",{cause:error});if(typeof globalThis.dispatchEvent==="function")globalThis.dispatchEvent(new CustomEvent("palamedes:catalogError",{detail:failure}));throw failure;});\ni18n.load(locale, fragment.messages);\n`,
            map: null,
            moduleSideEffects: true,
          };
        }

        if (!locales.includes(locale)) {
          this.error(`Palamedes message sidecar "${key}" requested unknown locale "${locale}".`);
        }

        let selected: Record<string, string> | null = null;
        try {
          selected = await compileSidecarLocale(cfg, entry, locale, {
            addWatchFile: (file) => this.addWatchFile(file),
            warn: (message) => this.warn(message),
          });
        } catch (error) {
          this.error(error instanceof Error ? error.message : String(error));
        }

        return { code: renderCatalogModule(selected ?? {}), map: null };
      },

      async generateBundle(_options, bundle) {
        if (
          !importMapBinding ||
          isServerEnvironment(this, false, legacyBuildSsr) ||
          sidecarModules.size === 0
        ) {
          return;
        }

        assertImportMapBase(resolvedBase);

        const cfg = await getConfigLazy();
        const locales = cfg.locales;
        const importMaps = new Map<string, Record<string, string>>(
          locales.map((locale) => [locale, {}]),
        );

        // Sorted for determinism: sidecarModules fills in transform order,
        // which varies between builds; unsorted emission would re-hash the
        // import maps of untouched locales on every build.
        const sortedSidecars = [...sidecarModules.entries()].sort(([a], [b]) => a.localeCompare(b));
        for (const [key, entry] of sortedSidecars) {
          for (const locale of locales) {
            const selected = await compileSidecarLocale(cfg, entry, locale, {
              warn: (message) => this.warn(message),
            });
            const asset = bareMessageAsset(renderCatalogModule(selected ?? {}), locale);
            const contentHash = createHash("sha256").update(asset).digest("hex").slice(0, 8);
            const fileName = `assets/palamedes-m-${key}.${locale}-${contentHash}.js`;
            this.emitFile({ type: "asset", fileName, source: asset });
            importMaps.get(locale)![`${BARE_MESSAGES_PREFIX}${key}`] = `${resolvedBase}${fileName}`;
          }
        }

        // Which chunk imports which bare message specifier, so servers can
        // emit modulepreload hints for the mapped assets of the chunks they
        // are about to serve and message assets load in parallel with the
        // code instead of one waterfall step behind it.
        const chunkImports: Record<string, string[]> = {};
        for (const fileName of Object.keys(bundle).sort()) {
          const output = bundle[fileName];
          if (!output || output.type !== "chunk") {
            continue;
          }
          const bareImports = output.imports
            .filter((imported) => imported.startsWith(BARE_MESSAGES_PREFIX))
            .sort();
          if (bareImports.length > 0) {
            chunkImports[fileName] = bareImports;
          }
        }

        const manifest: {
          locales: string[];
          importMaps: Record<string, string>;
          chunkImports: Record<string, string[]>;
        } = {
          locales,
          importMaps: {},
          chunkImports,
        };
        for (const [locale, imports] of importMaps) {
          const source = JSON.stringify({ imports });
          const contentHash = createHash("sha256").update(source).digest("hex").slice(0, 8);
          const fileName = `assets/palamedes-importmap.${locale}-${contentHash}.json`;
          this.emitFile({ type: "asset", fileName, source });
          manifest.importMaps[locale] = fileName;
        }
        this.emitFile({
          type: "asset",
          fileName: SPLIT_MANIFEST_NAME,
          source: JSON.stringify(manifest, null, 2),
        });
      },
    });
  }

  // React Router reloads the old document when importing a lazy route rejects.
  // A generated facade keeps that import valid and throws from the route's
  // normal render boundary instead, so its catalog-independent error UI runs.
  plugins.push({
    name: "palamedes:react-router-route-boundaries",
    augmentChunkHash(chunk) {
      if (!chunk.facadeModuleId?.includes("?__react-router-build-client-route")) return;
      return (
        createHash("sha256")
          // Rollup calls augmentChunkHash before rendered code exists. Hash the
          // complete generated template with a stable route-asset placeholder;
          // this couples facade-generator changes and export-shape changes to
          // the entry filename instead of relying on a fixed marker.
          .update(routeFacadeSource("./palamedes-route-[content-hash].js", chunk.exports))
          .digest("hex")
      );
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (
          chunk.type !== "chunk" ||
          !chunk.facadeModuleId?.includes("?__react-router-build-client-route")
        )
          continue;
        const facade = createRouteFacade(chunk);
        this.emitFile({
          type: "asset",
          fileName: facade.assetFileName,
          source: facade.assetSource,
        });
        chunk.code = facade.facadeSource;
        chunk.map = null;
      }
    },
  });

  // Static HTML applications have no SSR host to bind an import map. Delay
  // their module entry until the document's locale policy selected a map.
  plugins.push({
    name: "palamedes:html-delivery",
    enforce: "post",
    generateBundle(_options, bundle) {
      const manifestAsset = bundle[SPLIT_MANIFEST_NAME];
      if (!manifestAsset || manifestAsset.type !== "asset") return;
      const manifest = JSON.parse(String(manifestAsset.source)) as {
        importMaps: Record<string, string>;
      };
      const maps = Object.fromEntries(
        Object.entries(manifest.importMaps).map(([locale, file]) => {
          const asset = bundle[file];
          if (!asset || asset.type !== "asset")
            throw new Error("Missing generated locale import map.");
          return [locale, JSON.parse(String(asset.source))];
        }),
      );
      for (const output of Object.values(bundle)) {
        if (output.type !== "asset" || !output.fileName.endsWith(".html")) continue;
        const entries: string[] = [];
        let nonceAttribute = "";
        let html = String(output.source).replace(
          /<script\b[^>]*type=["']module["'][^>]*>[\s\S]*?<\/script>/giu,
          (script) => {
            const src = script.match(/\bsrc=["']([^"']+)["']/iu)?.[1];
            if (!src) return script;
            nonceAttribute ||= script.match(/\bnonce=["'][^"']*["']/iu)?.[0] ?? "";
            entries.push(src);
            return "";
          },
        );
        if (!entries.length) continue;
        html = html.replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>/giu, "");
        const code = `const maps=${JSON.stringify(maps)};try{const locale=document.documentElement.lang;if(!Object.hasOwn(maps,locale))throw new Error("Unsupported document catalog locale.");const map=document.createElement("script");map.type="importmap";map.nonce=document.querySelector("script[data-palamedes-entry]")?.nonce||"";map.textContent=JSON.stringify(maps[locale]);document.head.append(map);await Promise.all(${JSON.stringify(entries)}.map(url=>import(url)))}catch(error){const template=document.querySelector("template[data-palamedes-error]");if(template){document.body.replaceChildren(template.content.cloneNode(true));}else{document.body.innerHTML='<main role="alert"><h1>This page is temporarily unavailable.</h1><p>Reload the page to try again.</p><a href="" target="_self">Reload page</a> <a href="/" target="_self">Go home</a></main>';}}`;
        const hash = createHash("sha256").update(code).digest("hex").slice(0, 12);
        const fileName = `assets/palamedes-entry-${hash}.js`;
        this.emitFile({ type: "asset", fileName, source: code });
        output.source = html.replace(
          "</body>",
          `<script type="module" data-palamedes-entry ${nonceAttribute} src="${resolvedBase}${fileName}"></script></body>`,
        );
      }
    },
  });

  // Plugin 4: PO file loader
  plugins.push({
    name: "palamedes:server-catalogs",
    resolveId(id) {
      return id === VIRTUAL_SERVER_CATALOGS ? RESOLVED_SERVER_CATALOGS : undefined;
    },
    async load(id, loadOptions) {
      if (id !== RESOLVED_SERVER_CATALOGS) return null;
      if (!isServerEnvironment(this, loadOptions?.ssr === true, legacyBuildSsr)) {
        this.error(
          "virtual:palamedes/server-catalogs is server-only and cannot be loaded in a browser build.",
        );
      }
      const cfg = await getConfigLazy();
      addConfigWatchFiles(cfg, (file) => this.addWatchFile(file));
      const loaders = Object.fromEntries(
        cfg.locales.map((locale) => {
          const imports = cfg.catalogs.map((catalog) => catalogResourcePath(cfg, catalog, locale));
          const expressions = imports.map(
            (resourcePath) =>
              `import(${JSON.stringify(resourcePath)}).then((module) => module.messages)`,
          );
          return [
            locale,
            `() => Promise.all([${expressions.join(",")}]).then((catalogs) => catalogs.flat())`,
          ];
        }),
      );
      const loaderCode = Object.entries(loaders)
        .map(([locale, expression]) => `${JSON.stringify(locale)}: ${expression}`)
        .join(",");
      return {
        code: `import { createServerCatalogStore } from "@palamedes/runtime/server";\nconst loaders={${loaderCode}};\nconst store=createServerCatalogStore({load:({locale})=>{if(!Object.hasOwn(loaders,locale)) throw new Error("Unsupported catalog locale"); return loaders[locale]();}});\nexport const loadServerCatalog=(locale)=>store.load(locale);`,
        map: null,
      };
    },
  });

  if (enablePoLoader) {
    plugins.push({
      name: "palamedes:po-loader",

      async transform(src, id) {
        if (!PO_FILE_REGEX.test(id)) {
          return null;
        }

        const cfg = await getConfigLazy();
        addConfigWatchFiles(cfg, (file) => this.addWatchFile(file));
        const cleanId = stripQuery(id);
        const locale = catalogLocaleForResource(cfg, cleanId);
        const result = await compileCatalogModuleAsync(catalogArtifactConfig(cfg), cleanId, {
          locale,
          pseudoLocale: cfg.pseudoLocale,
          failOnMissing,
          ...(failOnCompileError === undefined ? {} : { failOnCompileError }),
          missingFailureHint:
            "You see this error because `failOnMissing=true` in Vite plugin configuration.",
        });

        result.watchFiles.forEach((file: string) => this.addWatchFile(file));
        // this.warn deduplicates and shows up in Vite's overlay/diagnostics.
        result.warnings.forEach((warning) => this.warn(warning));

        return {
          code: result.code,
          map: null,
        };
      },
    });
  }

  return plugins;
}

export default palamedes;
