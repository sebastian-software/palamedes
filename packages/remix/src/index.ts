import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type { registerHooks } from "node:module";
import type { ModuleLoader } from "remix/assets";
import { SourceMapConsumer, SourceMapGenerator, type RawSourceMap } from "source-map-js";

import {
  digestConfig,
  getConfigDependencies,
  loadPalamedesConfigSync,
  type LoadedPalamedesConfig,
} from "@palamedes/config";
import { compileCatalogModule } from "@palamedes/core-node";
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
   * Defaults to `true` in every environment. Set to `false` for compact,
   * hash-only output when bundle size or embedding authored source text is a
   * concern.
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
>;

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

// The Node loader must exclude CommonJS .cjs/.cts: macro lowering injects ESM
// imports. Bundler integrations can safely use the wider shared default.
const DEFAULT_INCLUDE = /\.(tsx?|jsx?|mjs|mts)$/;
const DEFAULT_EXCLUDE = /[/\\]node_modules[/\\]/;
const PO_FILE = /\.po$/;
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

    return transformLoadedModule(url, loaded, transformOptions, false);
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
    keepSourceFallbacks: options.keepSourceFallbacks ?? true,
    stripNonEssentialProps: process.env.NODE_ENV === "production",
  };
}

function transformLoadedModule<Loaded extends { source?: unknown }>(
  url: string,
  loaded: Loaded,
  options: ResolvedMacroTransformOptions,
  composeIncomingSourceMap: boolean,
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
  const locale = path.basename(resourcePath, ".po");
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
