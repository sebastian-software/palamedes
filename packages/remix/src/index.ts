import { Script } from "node:vm";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, watch, type FSWatcher } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type { registerHooks } from "node:module";
import type { ModuleLoader } from "remix/assets";
import { SourceMapConsumer, SourceMapGenerator, type RawSourceMap } from "source-map-js";

import {
  digestConfig,
  getConfigDependencies,
  catalogMatchesSource,
  catalogResourcePath,
  loadPalamedesConfigSync,
  type LoadedPalamedesConfig,
} from "@palamedes/config";
import {
  defineCompiledCatalog,
  isCompiledCatalog,
  type CompiledCatalogMessages,
} from "@palamedes/core/compiled";
import {
  compileCatalogArtifactSelected,
  compileCatalogModule,
  compileCatalogModuleAsync,
  renderCatalogModule,
} from "@palamedes/core-node";
import { createServerCatalogStore } from "@palamedes/runtime/server";
import {
  resolveMacroRuntimeModule,
  transformPalamedesMacros,
  type SourceMap,
} from "@palamedes/transform";

export type PalamedesRemixRegisterOptions = {
  /**
   * Files eligible for macro transformation.
   * @default /\.(tsx?|jsx?|mjs|mts)$/
   */
  include?: RegExp;

  /**
   * Files excluded from macro transformation.
   * @default /[/\\]node_modules[/\\]/
   */
  exclude?: RegExp;

  /**
   * Advanced override for the module imported for the runtime i18n getter.
   * @default "@palamedes/runtime"
   */
  runtimeModule?: string;

  /**
   * Preserve authored source messages as diagnostic metadata only.
   * Defaults to `false` in every environment. Set to `true` for diagnostic
   * metadata when deployment skew makes authored source text useful.
   * V2 runtime misses throw; this metadata never provides replacement output.
   */
  keepSourceFallbacks?: boolean;

  /**
   * Optional Palamedes config path used for `.po` catalog imports.
   * Relative paths resolve from the imported catalog file's directory.
   */
  configPath?: string;

  /**
   * Fail `.po` catalog compilation when a translation is missing.
   * @default false
   */
  failOnMissing?: boolean;

  /**
   * Fail `.po` catalog compilation when catalog diagnostics include errors.
   * @deprecated Palamedes v2 always rejects invalid and unsupported ICU;
   * remove this option.
   */
  failOnCompileError?: boolean;
};

/** Options shared by Remix browser asset macro transforms. */
export type PalamedesRemixAssetLoaderOptions = Pick<
  PalamedesRemixRegisterOptions,
  "include" | "exclude" | "runtimeModule" | "keepSourceFallbacks"
> & {
  /** Optional graph-split registry for executable locale fragments. */
  catalogAssets?: PalamedesRemixCatalogAssetRegistry;
};

export type PalamedesRemixCatalogAssetRegistry = {
  register(sourcePath: string, compiledIds: readonly string[]): string;
  /** Load the complete executable catalog for one active server locale. */
  load?(locale: string): Promise<CompiledCatalogMessages>;
  /** Return the current config/catalog generation for HTTP cache keys. */
  generation?(): string;
  sidecarUrl(key: string): string;
  serve(request: Request): Response | undefined;
  invalidate(sourcePath?: string): void;
  /** Close development file watchers when the host shuts down. */
  close?(): void;
};

export type CreatePalamedesRemixCatalogAssetRegistryOptions = {
  configPath?: string;
  cwd?: string;
  basePath?: string;
  /** Watch catalog/config files; defaults to development and Node --watch processes. */
  watch?: boolean;
};

type RegisterHooksOptions = Parameters<typeof registerHooks>[0];

export type LoadHook = NonNullable<RegisterHooksOptions["load"]>;
export type LoadResult = ReturnType<LoadHook>;

/** Packages imported by the default browser transform output. */
export const PALAMEDES_REMIX_ASSET_PACKAGES = [
  "@palamedes/core",
  "@palamedes/runtime",
  "@palamedes/remix",
] as const;

/** @deprecated Use PALAMEDES_REMIX_ASSET_PACKAGES. */
export const PALEMEDES_REMIX_ASSET_PACKAGES = PALAMEDES_REMIX_ASSET_PACKAGES;

export function createPalamedesRemixCatalogAssetRegistry(
  options: CreatePalamedesRemixCatalogAssetRegistryOptions = {},
): PalamedesRemixCatalogAssetRegistry {
  let config = loadPalamedesConfigSync(options);
  let configDigest = digestConfig(config);
  let catalogGenerationDigest = catalogDigest(config);
  const basePath = options.basePath ?? "/assets";
  const watchers: FSWatcher[] = [];
  const shouldWatch =
    options.watch ??
    (process.env.NODE_ENV === "development" || process.execArgv.includes("--watch"));
  let refreshFailure: unknown;
  let closed = false;
  let refreshQueued = false;
  const fragmentAssets = new Map<string, { source: string; etag: string }>();
  const entries = new Map<string, { sourcePath: string; compiledIds: string[] }>();
  const keysBySource = new Map<string, string>();
  const serverCatalogStore = createServerCatalogStore({
    async load({ locale }) {
      const catalogs = config.catalogs;
      if (catalogs.length === 0) {
        throw new Error("Palamedes config does not define a catalog for server loading.");
      }
      return await Promise.all(
        catalogs.map(async (catalog) => {
          const result = await compileCatalogModuleAsync(
            toCatalogArtifactConfig(config),
            catalogResourcePath(config, catalog, locale),
            {
              locale,
              pseudoLocale: config.pseudoLocale,
              missingFailureHint:
                "You see this error because executable Remix server catalog compilation failed on a missing translation.",
              compileFailureHint:
                "These errors fail loading because executable Remix server catalog compilation was configured as fatal.",
              diagnosticsWarningHint:
                "Inspect the generated Remix server catalog diagnostics before deploying this locale.",
            },
          );
          result.warnings.forEach((warning) => console.warn(warning));
          return evaluateCompiledCatalogModule(result.code);
        }),
      );
    },
  });

  const refreshConfig = (): void => {
    const nextConfig = loadPalamedesConfigSync(options);
    const nextDigest = digestConfig(nextConfig);
    if (nextDigest === configDigest) {
      return;
    }
    config = nextConfig;
    configDigest = nextDigest;
    catalogGenerationDigest = catalogDigest(config);
    serverCatalogStore.invalidate();
    fragmentAssets.clear();
  };

  const refreshCatalogGeneration = (): void => {
    const nextDigest = catalogDigest(config);
    if (nextDigest === catalogGenerationDigest) {
      return;
    }
    catalogGenerationDigest = nextDigest;
    serverCatalogStore.invalidate();
    fragmentAssets.clear();
  };

  const register = (sourcePath: string, compiledIds: readonly string[]): string => {
    const source = canonicalSourcePath(sourcePath);
    const normalizedIds = [...new Set(compiledIds)].sort();
    const key = createCatalogKey(source, normalizedIds);
    const previousKey = keysBySource.get(source);
    if (previousKey && previousKey !== key) {
      entries.delete(previousKey);
      for (const assetKey of fragmentAssets.keys())
        if (assetKey.startsWith(`${previousKey}:`)) fragmentAssets.delete(assetKey);
    }
    keysBySource.set(source, key);
    entries.set(key, { sourcePath: source, compiledIds: normalizedIds });
    return key;
  };

  const refreshCatalogState = (): void => {
    refreshConfig();
    refreshCatalogGeneration();
  };

  const watchInputs = (): void => {
    watchers.splice(0).forEach((watcher) => watcher.close());
    if (!shouldWatch || closed) return;
    const files = new Set(
      [
        ...getConfigDependencies(config),
        ...config.catalogs.flatMap((catalog) =>
          config.locales.map((locale) => catalogResourcePath(config, catalog, locale)),
        ),
      ].map((file) => path.resolve(file)),
    );
    const watched = new Set<string>();
    const watchDirectory = (directory: string): void => {
      if (watched.has(directory)) return;
      try {
        const watcher = watch(directory, { persistent: false }, (_event, filename) => {
          if (filename) {
            const changed = path.join(directory, filename.toString());
            if (
              ![...files].some(
                (file) => file === changed || file.startsWith(`${changed}${path.sep}`),
              )
            )
              return;
          }
          if (refreshQueued || closed) return;
          refreshQueued = true;
          queueMicrotask(() => {
            refreshQueued = false;
            if (closed) return;
            try {
              refreshCatalogState();
              refreshFailure = undefined;
              watchInputs();
            } catch (error) {
              refreshFailure = error;
              serverCatalogStore.invalidate();
            }
          });
        });
        watcher.on("error", (error) => {
          refreshFailure = error;
          serverCatalogStore.invalidate();
        });
        watchers.push(watcher);
        watched.add(directory);
      } catch (error) {
        if (!isMissingFileError(error) || path.dirname(directory) === directory) throw error;
        watchDirectory(path.dirname(directory));
      }
    };
    for (const directory of new Set([...files].map((file) => path.dirname(file))))
      watchDirectory(directory);
  };
  watchInputs();

  return {
    register,

    load(locale) {
      if (refreshFailure) return Promise.reject(refreshFailure);
      if (!config.locales.includes(locale)) {
        return Promise.reject(new Error(`Unsupported Palamedes catalog locale "${locale}".`));
      }
      return serverCatalogStore.load(locale);
    },

    generation() {
      if (refreshFailure) throw refreshFailure;
      return `${configDigest}:${catalogGenerationDigest}`;
    },

    sidecarUrl(key) {
      return `${basePath.replace(/\/$/u, "")}/__palamedes/catalog-fragments/${key}.js`;
    },

    serve(request) {
      if (refreshFailure) throw refreshFailure;
      const url = new URL(request.url);
      const prefix = `${basePath.replace(/\/$/u, "")}/__palamedes/catalog-fragments/`;
      if (!url.pathname.startsWith(prefix) || !url.pathname.endsWith(".js")) {
        return;
      }

      const key = url.pathname.slice(prefix.length, -3);
      const entry = entries.get(key);
      if (!entry) {
        return new Response(`Unknown Palamedes catalog fragment "${key}".`, { status: 404 });
      }
      const locale = url.searchParams.get("locale");
      if (!url.searchParams.has("fragment")) {
        const fragmentUrl = `${thisSidecarUrl(basePath, key)}fragment=1&locale=`;
        const source =
          `import{defineCompiledCatalog as __define}from"@palamedes/core/compiled";` +
          `import{getI18n as __getI18n,loadRegisteredMessages as __load,registerMessageLoaderGroup as __register}from"@palamedes/runtime";` +
          `const __locale=document.documentElement.lang;` +
          `__register(${JSON.stringify(key)},[{[__locale]:async()=>` +
          `__define((await import(${JSON.stringify(fragmentUrl)}+encodeURIComponent(__locale))).messages)}]);` +
          `let __active;try{__active=__getI18n()}catch(__error){` +
          `if(!(__error instanceof Error&&__error.message.includes("No active client i18n instance")))throw __error}` +
          `if(__active)await __load(__active,__locale);`;
        return new Response(source, {
          headers: {
            "cache-control": "no-cache",
            "content-type": "application/javascript; charset=utf-8",
          },
        });
      }
      if (!locale || !config.locales.includes(locale)) {
        return new Response("Palamedes catalog fragments require a supported locale.", {
          status: 400,
        });
      }

      const cacheKey = `${key}:${locale}`;
      const cached = fragmentAssets.get(cacheKey);
      if (cached) return serveFragment(cached, request);

      try {
        const catalogs = config.catalogs.filter((candidate) =>
          catalogMatchesSource(config, candidate, entry.sourcePath),
        );
        if (catalogs.length === 0) {
          return new Response(
            `Palamedes source module "${entry.sourcePath}" is not included in a configured catalog.`,
            { status: 500 },
          );
        }
        const messages = Object.create(null);
        for (const catalog of catalogs) {
          const result = compileCatalogArtifactSelected(
            {
              rootDir: config.rootDir,
              locales: config.locales,
              sourceLocale: config.sourceLocale,
              fallbackLocales: config.fallbackLocales,
              pseudoLocale: config.pseudoLocale,
              catalogs: [catalog],
            },
            catalogResourcePath(config, catalog, locale),
            entry.compiledIds,
          );
          Object.assign(messages, result.messages);
        }
        const source = `${stripCatalogBranding(renderCatalogModule(messages))}export const locale=${JSON.stringify(locale)};`;
        const etag = `"${createHash("sha256").update(source).digest("hex")}"`;
        const asset = { source, etag };
        fragmentAssets.set(cacheKey, asset);
        return serveFragment(asset, request);
      } catch (error) {
        return new Response(
          `Palamedes catalog fragment failed for "${entry.sourcePath}" (${locale}): ${error instanceof Error ? error.message : String(error)}`,
          { status: 500 },
        );
      }
    },

    close() {
      closed = true;
      watchers.splice(0).forEach((watcher) => watcher.close());
    },

    invalidate(sourcePath) {
      refreshCatalogState();
      refreshFailure = undefined;
      watchInputs();
      if (sourcePath === undefined) {
        serverCatalogStore.invalidate();
        fragmentAssets.clear();
      } else {
        const source = canonicalSourcePath(sourcePath);
        const key = keysBySource.get(source);
        if (key) {
          entries.delete(key);
          keysBySource.delete(source);
        }
      }
    },
  };
}

function canonicalSourcePath(source: string): string {
  try {
    return realpathSync(source);
  } catch {
    try {
      return path.join(realpathSync(path.dirname(source)), path.basename(source));
    } catch {
      return path.resolve(source);
    }
  }
}

function serveFragment(asset: { source: string; etag: string }, request: Request): Response {
  const headers = {
    "cache-control": "no-cache",
    etag: asset.etag,
    "content-type": "application/javascript; charset=utf-8",
  };
  return request.headers.get("if-none-match") === asset.etag
    ? new Response(null, { status: 304, headers })
    : new Response(asset.source, { headers });
}

function thisSidecarUrl(basePath: string, key: string): string {
  return `${basePath.replace(/\/$/u, "")}/__palamedes/catalog-fragments/${key}.js?`;
}

function createCatalogKey(sourcePath: string, compiledIds: readonly string[]): string {
  return createHash("sha256")
    .update(path.resolve(sourcePath))
    .update("\0")
    .update(JSON.stringify(compiledIds))
    .digest("hex")
    .slice(0, 16);
}

function catalogDigest(config: LoadedPalamedesConfig): string {
  const digest = createHash("sha256");
  for (const catalog of config.catalogs) {
    for (const locale of config.locales) {
      const resource = catalogResourcePath(config, catalog, locale);
      digest.update(resource);
      digest.update("\0");
      try {
        digest.update(readFileSync(resource));
      } catch (error) {
        if (!isMissingFileError(error)) {
          throw error;
        }
        digest.update("missing");
      }
      digest.update("\0");
    }
  }
  return digest.digest("hex");
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function toCatalogArtifactConfig(config: LoadedPalamedesConfig) {
  return {
    rootDir: config.rootDir,
    locales: config.locales,
    sourceLocale: config.sourceLocale,
    fallbackLocales: config.fallbackLocales,
    pseudoLocale: config.pseudoLocale,
    catalogs: config.catalogs,
  };
}

/** Evaluate native-generated module code on the server without accepting authored ICU text. */
function evaluateCompiledCatalogModule(source: string): CompiledCatalogMessages {
  const body = source
    .replace(
      /^import\{defineCompiledCatalog as __palamedesDefineCompiledCatalog\}from"@palamedes\/core\/compiled";/u,
      "",
    )
    .replace(/export const messages=/u, "return ")
    .replace(/;export default \{ messages \};$/u, ";");
  const evaluate = new Script(`(function(__palamedesDefineCompiledCatalog){${body}})`, {
    filename: "palamedes-generated-server-catalog.js",
  }).runInThisContext() as (define: typeof defineCompiledCatalog) => CompiledCatalogMessages;
  const messages = evaluate(defineCompiledCatalog);
  if (!isCompiledCatalogObject(messages)) {
    throw new TypeError(
      "Palamedes generated server catalog did not produce an executable catalog.",
    );
  }
  return messages;
}

function isCompiledCatalogObject(value: unknown): value is CompiledCatalogMessages {
  return isCompiledCatalog(value);
}

/** Keep fragments free of a bare package import; the importing browser module
 * brands generated functions through its rewritten core asset URL. */
function stripCatalogBranding(source: string): string {
  return source
    .replace(/^import\{defineCompiledCatalog as [^}]+\}from"@palamedes\/core\/compiled";/u, "")
    .replace(
      /export const messages=__palamedesDefineCompiledCatalog\((.*)\);export default \{ messages \};/su,
      "export const messages=$1;export default { messages };",
    );
}

// The Node loader must exclude CommonJS .cjs/.cts: macro lowering injects ESM
// imports. Bundler integrations can safely use the wider shared default.
const DEFAULT_INCLUDE = /\.(tsx?|jsx?|mjs|mts)$/;
const DEFAULT_EXCLUDE = /[/\\]node_modules[/\\]/;
const PO_FILE = /\.(?:po|fcl)$/;
const CONFIG_WATCH_QUERY_PARAM = "palamedes-config-watch";
const INLINE_SOURCE_MAP_COMMENT =
  /(?:\r?\n)?(?:\/\/# sourceMappingURL=data:application\/json[^,\r\n]*;base64,([A-Za-z0-9+/=]+)|\/\*# sourceMappingURL=data:application\/json[^,\r\n]*;base64,([A-Za-z0-9+/=]+) \*\/)(?:\r?\n)?$/u;

type CachedPalamedesConfig = {
  config: LoadedPalamedesConfig;
  digest: string;
};

type ResolvedMacroTransformOptions = {
  exclude: RegExp;
  include: RegExp;
  keepSourceFallbacks: boolean;
  runtimeModule: string;
  stripNonEssentialProps: boolean;
};

export function createPalamedesRemixLoadHook(
  options: PalamedesRemixRegisterOptions = {},
): LoadHook {
  const transformOptions = resolveMacroTransformOptions(options);
  const configCache = new Map<string, CachedPalamedesConfig>();

  return (url, context, nextLoad) => {
    if (isConfigWatchUrl(url)) {
      return {
        format: "module",
        shortCircuit: true,
        source: "",
      };
    }

    if (shouldLoadCatalogUrl(url, transformOptions.exclude)) {
      return loadCatalogModule(url, options, configCache);
    }

    const loaded = nextLoad(url, context);
    if (!shouldTransformUrl(url, transformOptions) || loaded.source == null) {
      return loaded;
    }

    return transformLoadedModule(url, loaded, transformOptions, true);
  };
}

/**
 * Create the post-compile loader used by Remix's browser asset server.
 *
 * Add the returned loader to `scripts.loaders` and add
 * `PALAMEDES_REMIX_ASSET_PACKAGES` to the asset server's `allowPackages`.
 */
export function createPalamedesRemixAssetLoader(
  options: PalamedesRemixAssetLoaderOptions = {},
): ModuleLoader {
  const transformOptions = resolveMacroTransformOptions(options);

  return (url, context, nextLoad) => {
    const loaded = nextLoad(url, context);
    if (!shouldTransformUrl(url, transformOptions) || loaded.source == null) {
      return loaded;
    }

    let macroResult: ReturnType<typeof transformPalamedesMacros> | undefined;
    const transformed = transformLoadedModule(url, loaded, transformOptions, false, (result) => {
      macroResult = result;
    });
    if (!options.catalogAssets || transformed.source == null || !macroResult) {
      return transformed;
    }

    if (!macroResult.hasChanged || macroResult.compiledIds.length === 0) {
      return transformed;
    }
    const key = options.catalogAssets.register(fileURLToPath(url), macroResult.compiledIds);
    const sidecar = options.catalogAssets.sidecarUrl(key);
    const sidecarImport = `${sidecar}?fragment=1&locale=`;
    const catalogPrelude =
      `import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";` +
      `import{getI18n as __palamedesGetI18n,loadRegisteredMessages as __palamedesLoadRegisteredMessages,registerMessageLoaderGroup as __palamedesRegisterMessageLoaderGroup}from"@palamedes/runtime";\n` +
      `const __palamedesLocale=document.documentElement.lang;` +
      `const __palamedesMessages=__palamedesDefineCompiledCatalog((await import(new URL(${JSON.stringify(sidecarImport)}+encodeURIComponent(__palamedesLocale),document.baseURI)).catch(__error=>{globalThis.dispatchEvent(new CustomEvent("palamedes:catalog-error",{detail:__error}));throw __error})).messages);` +
      `__palamedesRegisterMessageLoaderGroup(${JSON.stringify(key)},[{[__palamedesLocale]:async()=>__palamedesMessages}]);` +
      `let __palamedesActive;try{__palamedesActive=__palamedesGetI18n()}catch(__palamedesError){` +
      `if(!(__palamedesError instanceof Error&&__palamedesError.message.includes("No active client i18n instance")))throw __palamedesError}` +
      `if(__palamedesActive)await __palamedesLoadRegisteredMessages(__palamedesActive,__palamedesLocale);\n`;
    return {
      ...transformed,
      source: `${catalogPrelude}${stringifySource(transformed.source)}\n`,
    };
  };
}

function resolveMacroTransformOptions(
  options: PalamedesRemixAssetLoaderOptions,
): ResolvedMacroTransformOptions {
  return {
    include: options.include ?? DEFAULT_INCLUDE,
    exclude: options.exclude ?? DEFAULT_EXCLUDE,
    runtimeModule: resolveMacroRuntimeModule(options.runtimeModule),
    // Keep misses readable across production deploy skew by default. Hosts that
    // must not embed authored text can choose the compact, hash-only behavior.
    keepSourceFallbacks: options.keepSourceFallbacks ?? false,
    stripNonEssentialProps: process.env.NODE_ENV === "production",
  };
}

function transformLoadedModule<Loaded extends { source?: unknown }>(
  url: string,
  loaded: Loaded,
  options: ResolvedMacroTransformOptions,
  composeIncomingSourceMap: boolean,
  onResult?: (result: ReturnType<typeof transformPalamedesMacros>) => void,
): Loaded {
  const filePath = fileURLToPath(url);
  const source = stringifySource(loaded.source);
  let result: ReturnType<typeof transformPalamedesMacros>;
  try {
    result = transformPalamedesMacros(source, filePath, {
      runtimeModule: options.runtimeModule,
      keepSourceFallbacks: options.keepSourceFallbacks,
      stripNonEssentialProps: options.stripNonEssentialProps,
    });
  } catch (error) {
    const detail = remapTransformDiagnostic(
      error instanceof Error ? error.message : String(error),
      filePath,
      source,
    );
    throw new Error(`Failed to transform Palamedes macros in ${filePath}: ${detail}`, {
      cause: error,
    });
  }

  onResult?.(result);

  if (!result.hasChanged) {
    return loaded;
  }

  return {
    ...loaded,
    source: appendInlineSourceMap(
      stripInlineSourceMap(result.code),
      composeIncomingSourceMap ? composeSourceMaps(result.map, source) : result.map,
    ),
  };
}

function shouldLoadCatalogUrl(url: string, exclude: RegExp): boolean {
  if (!url.startsWith("file:")) {
    return false;
  }

  const filePath = fileURLToPath(url);
  return PO_FILE.test(filePath) && !exclude.test(filePath);
}

function loadCatalogModule(
  url: string,
  options: Pick<
    PalamedesRemixRegisterOptions,
    "configPath" | "failOnMissing" | "failOnCompileError"
  >,
  configCache: Map<string, CachedPalamedesConfig>,
): LoadResult {
  const resourcePath = fileURLToPath(url);
  const config = getPalamedesConfigForCatalog(resourcePath, options.configPath, configCache);
  const locale =
    config.locales.find((candidate) =>
      config.catalogs.some(
        (catalog) =>
          path.resolve(catalogResourcePath(config, catalog, candidate)) ===
          path.resolve(resourcePath),
      ),
    ) ?? path.basename(resourcePath, path.extname(resourcePath));
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
      ...(options.failOnCompileError === undefined
        ? {}
        : { failOnCompileError: options.failOnCompileError }),
      missingFailureHint:
        "You see this error because `failOnMissing=true` in Palamedes Remix register options.",
    },
  );

  result.warnings.forEach((warning) => console.warn(warning));

  return {
    format: "module",
    shortCircuit: true,
    source: prependConfigWatchImports(result.code, config),
  };
}

function getPalamedesConfigForCatalog(
  resourcePath: string,
  configPath: string | undefined,
  configCache: Map<string, CachedPalamedesConfig>,
): LoadedPalamedesConfig {
  const cwd = path.dirname(resourcePath);
  const cacheKey = `${cwd}\0${configPath ?? ""}`;
  const cached = configCache.get(cacheKey);
  if (cached && isCurrentConfig(cached)) {
    return cached.config;
  }

  const config = loadPalamedesConfigSync({ cwd, configPath });
  cacheConfig(configCache, cacheKey, config);
  return config;
}

function isCurrentConfig(cached: CachedPalamedesConfig): boolean {
  try {
    return digestConfig(cached.config) === cached.digest;
  } catch {
    return false;
  }
}

function cacheConfig(
  configCache: Map<string, CachedPalamedesConfig>,
  cacheKey: string,
  config: LoadedPalamedesConfig,
): void {
  try {
    configCache.set(cacheKey, { config, digest: digestConfig(config) });
  } catch {
    // Tests and virtual configs may not have a readable config file.
  }
}

function isConfigWatchUrl(url: string): boolean {
  return url.startsWith("file:") && new URL(url).searchParams.has(CONFIG_WATCH_QUERY_PARAM);
}

function prependConfigWatchImports(code: string, config: LoadedPalamedesConfig): string {
  const imports = getConfigDependencies(config).map((dependency) => {
    const configUrl = pathToFileURL(dependency);
    configUrl.searchParams.set(CONFIG_WATCH_QUERY_PARAM, "");
    return `import ${JSON.stringify(configUrl.href)}`;
  });
  return `${imports.join("\n")}\n${code}`;
}

function shouldTransformUrl(url: string, options: ResolvedMacroTransformOptions): boolean {
  if (!url.startsWith("file:")) {
    return false;
  }

  const filePath = fileURLToPath(url);
  return matches(options.include, filePath) && !matches(options.exclude, filePath);
}

function matches(pattern: RegExp, value: string): boolean {
  pattern.lastIndex = 0;
  const matched = pattern.test(value);
  pattern.lastIndex = 0;
  return matched;
}

function stringifySource(source: unknown): string {
  if (typeof source === "string") {
    return source;
  }

  if (source instanceof ArrayBuffer) {
    return Buffer.from(source).toString("utf8");
  }

  if (ArrayBuffer.isView(source)) {
    return Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString("utf8");
  }

  throw new TypeError("Remix loader returned an unsupported module source");
}

function stripInlineSourceMap(code: string): string {
  return code.replace(INLINE_SOURCE_MAP_COMMENT, "");
}

function remapTransformDiagnostic(detail: string, filePath: string, source: string): string {
  try {
    const sourceMap = readInlineSourceMap(source);
    if (!sourceMap) {
      return detail;
    }

    const consumer = new SourceMapConsumer(sourceMap as unknown as RawSourceMap);
    const locationPattern = new RegExp(`${escapeRegExp(filePath)}:(\\d+):(\\d+)`, "gu");

    return detail.replace(locationPattern, (location, lineText, columnText) => {
      const line = Number(lineText);
      const column = unicodeColumnToUtf16(source, line, Number(columnText));
      const original = consumer.originalPositionFor({ line, column });
      if (original.line == null || original.column == null || original.source == null) {
        return location;
      }

      const originalSource = consumer.sourceContentFor(original.source, true);
      const originalColumn =
        originalSource == null
          ? original.column + 1
          : utf16ColumnToUnicode(originalSource, original.line, original.column);
      return `${original.source}:${original.line}:${originalColumn}`;
    });
  } catch {
    return detail;
  }
}

function readInlineSourceMap(source: string): SourceMap | null {
  const match = INLINE_SOURCE_MAP_COMMENT.exec(source);
  const encoded = match?.[1] ?? match?.[2];
  if (!encoded) {
    return null;
  }

  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as SourceMap;
}

function composeSourceMaps(transformedMap: SourceMap | null, source: string): SourceMap | null {
  if (!transformedMap) {
    return null;
  }

  try {
    const incomingMap = readInlineSourceMap(source);
    if (!incomingMap) {
      return transformedMap;
    }

    const transformedConsumer = new SourceMapConsumer(transformedMap as unknown as RawSourceMap);
    const incomingConsumer = new SourceMapConsumer(incomingMap as unknown as RawSourceMap);
    const composed = SourceMapGenerator.fromSourceMap(transformedConsumer);
    const intermediateSource =
      transformedConsumer.sources.find((candidate) => candidate === incomingConsumer.file) ??
      (transformedConsumer.sources.length === 1 ? transformedConsumer.sources[0] : undefined);
    if (!intermediateSource) {
      return transformedMap;
    }
    composed.applySourceMap(incomingConsumer, intermediateSource);
    return JSON.parse(composed.toString()) as SourceMap;
  } catch {
    return transformedMap;
  }
}

function unicodeColumnToUtf16(source: string, line: number, oneBasedColumn: number): number {
  const lineSource = source.split(/\r?\n/u)[line - 1] ?? "";
  const targetColumn = Math.max(0, oneBasedColumn - 1);
  let unicodeColumn = 0;
  let utf16Column = 0;
  for (const character of lineSource) {
    if (unicodeColumn >= targetColumn) {
      break;
    }
    unicodeColumn += 1;
    utf16Column += character.length;
  }
  return utf16Column;
}

function utf16ColumnToUnicode(source: string, line: number, zeroBasedColumn: number): number {
  const lineSource = source.split(/\r?\n/u)[line - 1] ?? "";
  let unicodeColumn = 1;
  let utf16Column = 0;
  for (const character of lineSource) {
    if (utf16Column >= zeroBasedColumn) {
      break;
    }
    unicodeColumn += 1;
    utf16Column += character.length;
  }
  return unicodeColumn;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function appendInlineSourceMap(code: string, map: SourceMap | null): string {
  if (!map) {
    return code;
  }

  const encoded = Buffer.from(JSON.stringify(map), "utf8").toString("base64");
  return `${code}\n//# sourceMappingURL=data:application/json;base64,${encoded}`;
}
