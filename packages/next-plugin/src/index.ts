/**
 * @palamedes/next-plugin
 *
 * Next.js integration for Palamedes using OXC-based macro transformation.
 * No Babel required!
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

import {
  createPalamedesSourceFilter,
  resolvePalamedesConfigPath,
  type PalamedesFilterPattern,
} from "@palamedes/config";
import { assertNoRemovedPalamedesOptions } from "@palamedes/core-node";

import {
  PALAMEDES_BUNDLER_TRANSFORM_INCLUDE,
  PALAMEDES_MACRO_PACKAGES,
  resolveMacroRuntimeModule,
} from "@palamedes/transform";

const require = createRequire(import.meta.url);

/*
 * `@palamedes/next-plugin/server` keys request state to this Next.js internal
 * module (see server.ts). Next has no public request-identity API that also
 * covers static generation and Client Component SSR, so this dependency is an
 * explicit, version-verified contract documented in docs/stability.md.
 */
const NEXT_WORK_ASYNC_STORAGE_MODULE = "next/dist/server/app-render/work-async-storage.external.js";
const NEXT_VERIFIED_VERSION = "16.4.1";

type TurbopackRules = NonNullable<NonNullable<NextConfig["turbopack"]>["rules"]>;
type TurbopackRuleConfigItem = Extract<TurbopackRules[string], { loaders?: unknown }>;
type TurbopackRuleCollectionEntry = Extract<TurbopackRules[string], unknown[]>[number];
type TurbopackLoaderItem = Exclude<TurbopackRuleConfigItem["loaders"], undefined>[number];

/*
 * Derived from the canonical macro package list so the content pre-filter can
 * never drift from the transform (it previously omitted @palamedes/solid/macro).
 */
const MACRO_CONTENT_PATTERN = new RegExp(
  PALAMEDES_MACRO_PACKAGES.map((name) => name.replaceAll(/[.*+?^${}()|[\]\\/]/gu, "\\$&")).join(
    "|",
  ),
);
const SERVER_FUNCTION_CONTENT_PATTERN = /["']use server["']/;
const SERVER_FUNCTION_INITIALIZER_MODULE = "@palamedes/next-plugin/server-function-initializer";
const SERVER_FUNCTION_ENTRY_MODULE = "@palamedes/next-plugin/server-function-entry";
const SERVER_FUNCTION_INITIALIZER_EXPORT = "initializeServerFunctionI18n";
const SERVER_FUNCTION_ENTRY_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
] as const;

/*
 * A Turbopack rule array is either the loader "shorthand" (a flat list of
 * loader specifiers, all applied to the glob) or a list of rule configs (each
 * with its own `condition`). The two look alike but mean different things, so
 * appending a rule config onto a shorthand list would produce a mixed array
 * with no defined semantics. Loader items are normalized into an equivalent
 * rule config first.
 */
function isTurbopackLoaderItem(entry: TurbopackRuleCollectionEntry): entry is TurbopackLoaderItem {
  return (
    typeof entry === "string" || (typeof entry === "object" && entry !== null && "loader" in entry)
  );
}

function normalizeTurbopackRuleCollection(
  entries: readonly TurbopackRuleCollectionEntry[],
): TurbopackRuleConfigItem[] {
  const normalized: TurbopackRuleConfigItem[] = [];
  let pendingLoaders: TurbopackLoaderItem[] = [];

  const flushLoaders = (): void => {
    if (pendingLoaders.length > 0) {
      normalized.push({ loaders: pendingLoaders });
      pendingLoaders = [];
    }
  };

  for (const entry of entries) {
    if (isTurbopackLoaderItem(entry)) {
      // Loader order within a shorthand run is significant; keep the run intact.
      pendingLoaders.push(entry);
      continue;
    }
    flushLoaders();
    normalized.push(entry);
  }
  flushLoaders();

  return normalized;
}

/*
 * Turbopack rules are keyed by glob; a glob can carry a list of rule configs.
 * Appending keeps user-supplied rules for the same glob intact instead of
 * silently overwriting them.
 */
function appendTurbopackRule(
  rules: TurbopackRules,
  glob: string,
  rule: TurbopackRuleConfigItem,
): void {
  const existing = rules[glob];
  if (existing === undefined) {
    rules[glob] = rule;
    return;
  }
  rules[glob] = Array.isArray(existing)
    ? [...normalizeTurbopackRuleCollection(existing), rule]
    : [existing, rule];
}

export type WithPalamedesOptions = {
  /**
   * Files to transform: a glob, a RegExp, or an array of both. Relative globs
   * resolve from `projectRoot`; RegExps test the absolute file path.
   * @default /\.([cm]?[jt]s|[jt]sx)$/
   */
  include?: PalamedesFilterPattern;

  /**
   * Files to skip, with the same pattern rules as `include`.
   * @default /node_modules/
   */
  exclude?: PalamedesFilterPattern;

  /**
   * Enable .po file compilation loader.
   * @default true
   */
  enablePoLoader?: boolean;

  /**
   * Path to a Palamedes config file.
   * Relative paths resolve from the Next project root. If not provided,
   * Palamedes searches for config automatically from that root.
   */
  configPath?: string;

  /**
   * Absolute or relative Next project directory. Set this when Next's project
   * directory cannot be derived automatically, for example in a custom host.
   */
  projectRoot?: string;

  /**
   * If true, fail compilation on missing translations.
   * @default false
   */
  failOnMissing?: boolean;

  /**
   * Advanced override for the module that exports the runtime getter.
   * @default "@palamedes/runtime"
   */
  runtimeModule?: string;

  /**
   * Include authored source messages as diagnostic source metadata.
   * Defaults to `false` in every environment. Set to `true` to include
   * authored source text in generated calls for diagnostics.
   * V2 runtime misses throw; this metadata never provides replacement output.
   */
  includeSourceMetadata?: boolean;

  /**
   * Monorepo workspace root to use for Turbopack and output file tracing.
   * If omitted, Palamedes will try to detect a workspace root from the Next
   * project root.
   */
  workspaceRoot?: string;

  /**
   * Initialize request-local i18n at the start of every recognized Next.js
   * Server Function. Requires a `palamedes.server` entry module exporting
   * `initializeServerFunctionI18n`.
   *
   * Automatically enabled when the conventional entry exists.
   */
  serverFunctions?: boolean;
};

function resolveServerFunctionInitializer(enabled: boolean | undefined, projectRoot: string) {
  if (enabled === false) return;

  const candidates = ["src", ""].flatMap((directory) =>
    SERVER_FUNCTION_ENTRY_EXTENSIONS.map((extension) =>
      path.join(projectRoot, directory, `palamedes.server${extension}`),
    ),
  );
  const matches = candidates.filter((candidate) => existsSync(candidate));

  if (matches.length === 0) {
    if (enabled === undefined) return;
    throw new Error(
      "Palamedes Server Function instrumentation requires a palamedes.server module in the project root or src directory. Export initializeServerFunctionI18n from that module.",
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Palamedes found multiple Server Function entry modules: ${matches.join(", ")}. Keep exactly one palamedes.server module.`,
    );
  }

  return {
    absolutePath: matches[0]!,
    turbopackAlias: `./${path.relative(projectRoot, matches[0]!).split(path.sep).join("/")}`,
  };
}

function resolveWorkspaceRoot(projectRoot: string, explicitRoot?: string) {
  if (explicitRoot) {
    return path.resolve(projectRoot, explicitRoot);
  }

  let currentDir = projectRoot;
  const initialDir = currentDir;

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");

    if (
      hasWorkspaces(packageJsonPath) ||
      existsSync(path.join(currentDir, "pnpm-workspace.yaml")) ||
      existsSync(path.join(currentDir, "turbo.json")) ||
      existsSync(path.join(currentDir, ".git"))
    ) {
      return currentDir === initialDir ? undefined : currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      return;
    }
    currentDir = parentDir;
  }
}

function installedNextVersion(): string | undefined {
  try {
    return (require("next/package.json") as { version?: string }).version;
  } catch {
    return undefined;
  }
}

/*
 * Resolve, but do not load, the internal module: loading it here would create
 * Next's shared AsyncLocalStorage singleton before Next installs its global
 * AsyncLocalStorage, and `next start` evaluates this config in its own process.
 */
function assertNextWorkAsyncStorageResolves(): void {
  try {
    require.resolve(NEXT_WORK_ASYNC_STORAGE_MODULE);
  } catch (error) {
    const version = installedNextVersion();
    throw new Error(
      `Palamedes could not resolve ${NEXT_WORK_ASYNC_STORAGE_MODULE} from the installed Next.js${version ? ` ${version}` : ""}. ` +
        `@palamedes/next-plugin/server keys request-scoped i18n to this Next.js internal module and is verified against Next.js ${NEXT_VERIFIED_VERSION}. ` +
        "Install a verified Next.js 16 release or report the new version in the Palamedes issue tracker.",
      { cause: error },
    );
  }
}

type NextConfigWithResolvedPath = NextConfig & { configFile?: string };

/** JSON-safe include/exclude pattern for loader options. */
type SerializedFilterPattern = string | { regexp: string; flags: string };

function filterPatternList(pattern: PalamedesFilterPattern): ReadonlyArray<string | RegExp> {
  if (pattern == null) {
    return [];
  }
  return typeof pattern === "string" || pattern instanceof RegExp ? [pattern] : pattern;
}

function serializeFilterPattern(pattern: string | RegExp): SerializedFilterPattern {
  return typeof pattern === "string" ? pattern : { regexp: pattern.source, flags: pattern.flags };
}
type WebpackContextWithDir = { dir?: unknown };

function resolveProjectRoot(
  options: Pick<WithPalamedesOptions, "projectRoot">,
  baseConfig: NextConfig,
  context?: WebpackContextWithDir,
): string {
  if (options.projectRoot) {
    return path.resolve(options.projectRoot);
  }

  if (typeof context?.dir === "string" && context.dir.length > 0) {
    return path.resolve(context.dir);
  }

  const configFile = (baseConfig as NextConfigWithResolvedPath).configFile;
  if (typeof configFile === "string" && configFile.length > 0) {
    return path.dirname(path.resolve(configFile));
  }

  const configProjectRoot = resolveNextConfigProjectRoot();
  if (configProjectRoot) {
    return configProjectRoot;
  }

  const cliProjectRoot = resolveNextCliProjectRoot();
  if (cliProjectRoot) {
    return cliProjectRoot;
  }

  return process.cwd();
}

function resolveNextConfigProjectRoot(): string | undefined {
  const stack = new Error("Resolve the Next config evaluation stack.").stack;
  if (!stack) {
    return;
  }

  for (const frame of stack.split("\n")) {
    const configFile = nextConfigFileFromStackFrame(frame);
    if (configFile) {
      return path.dirname(configFile);
    }
  }
}

function nextConfigFileFromStackFrame(frame: string): string | undefined {
  const configFileName = frame.match(/next\.config\.(?:[cm]?[jt]s)/u)?.[0];
  if (!configFileName) {
    return;
  }

  const configFileEnd = frame.indexOf(configFileName) + configFileName.length;
  const prefix = frame.slice(0, configFileEnd);
  const openingParenthesis = prefix.lastIndexOf("(");
  const rawPath = prefix
    .slice(openingParenthesis === -1 ? 0 : openingParenthesis + 1)
    .trim()
    .replace(/^at\s+(?:async\s+)?/u, "");

  if (!rawPath) {
    return;
  }

  return rawPath.startsWith("file:") ? fileURLToPath(rawPath) : path.resolve(rawPath);
}

const NEXT_CLI_COMMANDS = new Set(["build", "dev", "start"]);
const NEXT_CLI_OPTIONS_WITH_VALUES = new Set([
  "-H",
  "--debug-build-paths",
  "--experimental-build-mode",
  "--experimental-https-ca",
  "--experimental-https-cert",
  "--experimental-https-key",
  "--experimental-upload-trace",
  "--experimental-upload-trace,",
  "--hostname",
  "--inspect",
  "--internal-trace",
  "--keepAliveTimeout",
  "--port",
  "-p",
]);

function isNextCliEntry(argument: string | undefined): boolean {
  if (!argument) {
    return false;
  }

  const normalized = argument.replaceAll("\\", "/");
  return path.posix.basename(normalized) === "next" || normalized.includes("/next/dist/bin/");
}

function resolveNextCliProjectRoot(): string | undefined {
  if (!isNextCliEntry(process.argv[1]) || !NEXT_CLI_COMMANDS.has(process.argv[2] ?? "")) {
    return;
  }

  for (let index = 3; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (!argument) {
      continue;
    }

    if (argument === "--") {
      const directory = process.argv[index + 1];
      return directory ? path.resolve(directory) : undefined;
    }

    if (argument.startsWith("-")) {
      const option = argument.split("=", 1)[0];
      if (!argument.includes("=") && option && NEXT_CLI_OPTIONS_WITH_VALUES.has(option)) {
        index += 1;
      }
      continue;
    }

    return path.resolve(argument);
  }
}

function hasWorkspaces(packageJsonPath: string) {
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      workspaces?: unknown;
    };

    if (Array.isArray(packageJson.workspaces)) {
      return packageJson.workspaces.length > 0;
    }

    if (
      packageJson.workspaces &&
      typeof packageJson.workspaces === "object" &&
      Array.isArray((packageJson.workspaces as { packages?: unknown }).packages)
    ) {
      return (packageJson.workspaces as { packages: unknown[] }).packages.length > 0;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Wraps a Next.js config to add Palamedes OXC transformation.
 *
 * @example
 * ```js
 * // next.config.js
 * const { withPalamedes } = require("@palamedes/next-plugin")
 *
 * module.exports = withPalamedes({
 *   // your existing next config
 * })
 * ```
 */
export function withPalamedes(
  baseConfig: NextConfig = {},
  options: WithPalamedesOptions = {},
): NextConfig {
  assertNoRemovedPalamedesOptions(options, [
    "failOnCompileError",
    "keepSourceFallbacks",
    "messageSplitting",
    "cwd",
  ]);
  assertNextWorkAsyncStorageResolves();
  const {
    include = PALAMEDES_BUNDLER_TRANSFORM_INCLUDE,
    exclude = /node_modules/,
    enablePoLoader = true,
    configPath,
    failOnMissing = false,
    runtimeModule: explicitRuntimeModule,
    includeSourceMetadata: explicitIncludeSourceMetadata,
    projectRoot: explicitProjectRoot,
    workspaceRoot: explicitWorkspaceRoot,
    serverFunctions: serverFunctionOptions,
  } = options;

  const runtimeModule = resolveMacroRuntimeModule(explicitRuntimeModule);
  // Source metadata is optional diagnostics; compiled catalogs supply all message output.
  const includeSourceMetadata = explicitIncludeSourceMetadata ?? false;
  const stripNonEssentialProps = process.env.NODE_ENV === "production";
  const projectRoot = resolveProjectRoot({ projectRoot: explicitProjectRoot }, baseConfig);
  const resolvedConfigPath = resolvePalamedesConfigPath(projectRoot, configPath);
  const includePatterns = filterPatternList(include);
  const excludePatterns = filterPatternList(exclude);
  const serverFunctionEntry = resolveServerFunctionInitializer(serverFunctionOptions, projectRoot);
  const serverFunctions = serverFunctionEntry
    ? {
        initializerModule: SERVER_FUNCTION_INITIALIZER_MODULE,
        initializerExport: SERVER_FUNCTION_INITIALIZER_EXPORT,
      }
    : undefined;
  const workspaceRoot = resolveWorkspaceRoot(projectRoot, explicitWorkspaceRoot);
  const configuredTurbopackRoot =
    typeof baseConfig.turbopack?.root === "string"
      ? path.resolve(projectRoot, baseConfig.turbopack.root)
      : workspaceRoot;
  const outputFileTracingRoot =
    baseConfig.outputFileTracingRoot ??
    (typeof configuredTurbopackRoot === "string" ? configuredTurbopackRoot : undefined);

  // Resolve loader paths
  const oxcLoaderPath = require.resolve("@palamedes/next-plugin/palamedes-loader");
  const poLoaderPath = require.resolve("@palamedes/next-plugin/palamedes-po-loader");
  const serverCatalogLoaderPath =
    require.resolve("@palamedes/next-plugin/palamedes-server-catalogs-loader");
  const poLoaderOptions = {
    failOnMissing,
    cwd: projectRoot,
    ...(resolvedConfigPath ? { configPath: resolvedConfigPath } : {}),
  };
  const transformLoaderOptions = {
    runtimeModule,
    includeSourceMetadata,
    stripNonEssentialProps,
    cwd: projectRoot,
    ...(resolvedConfigPath ? { configPath: resolvedConfigPath } : {}),
    ...(serverFunctions ? { serverFunctions } : {}),
    // Turbopack matches rule paths relative to its own root, so the loader
    // applies the shared include/exclude filter to the absolute file path.
    sourceFilter: {
      projectRoot,
      include: includePatterns.map(serializeFilterPattern),
      exclude: excludePatterns.map(serializeFilterPattern),
    },
  };
  const clientFragmentFailureMode = "throw";

  const rules: TurbopackRules = { ...baseConfig.turbopack?.rules };

  // Transform local JS/TS files that actually import Palamedes macros.
  // Turbopack tests a rule's `path` condition against the module path relative
  // to its root, while include/exclude RegExps follow the shared contract and
  // test the absolute path. A user RegExp in the rule condition could therefore
  // skip the transform (`/\/src\//` misses `src/page.tsx`) or select files the
  // contract excludes, so only the loader's shared filter applies them. The
  // built-in default matches a file extension, which is the same suffix for
  // both path forms, so it still narrows the rule before the content check.
  const transformConditions = [
    { not: "foreign" },
    ...(include === PALAMEDES_BUNDLER_TRANSFORM_INCLUDE
      ? [{ path: PALAMEDES_BUNDLER_TRANSFORM_INCLUDE }]
      : []),
    {
      content: serverFunctions
        ? new RegExp(`${MACRO_CONTENT_PATTERN.source}|${SERVER_FUNCTION_CONTENT_PATTERN.source}`)
        : MACRO_CONTENT_PATTERN,
    },
  ];
  // Turbopack's built-in browser condition lets one unified graph produce a
  // plain client transform and a server transform with lazy message
  // sidecars. Keeping the rules disjoint prevents server-only catalog
  // loaders from entering browser chunks.
  appendTurbopackRule(rules, "*", {
    condition: { all: [...transformConditions, "browser"] },
    loaders: [
      {
        loader: oxcLoaderPath,
        options: {
          ...transformLoaderOptions,
          clientMessageSplitting: true,
          clientFragmentFailureMode,
        },
      },
    ],
  });
  appendTurbopackRule(rules, "*", {
    condition: { all: [...transformConditions, { not: "browser" }] },
    loaders: [
      {
        loader: oxcLoaderPath,
        options: {
          ...transformLoaderOptions,
        },
      },
    ],
  });

  appendTurbopackRule(rules, "catalog-fragment.cjs", {
    condition: { path: /[/\\]next-plugin[/\\]catalog-fragment\.cjs$/u },
    loaders: [{ loader: poLoaderPath, options: poLoaderOptions }],
    as: "*.js",
  });

  appendTurbopackRule(rules, "server-catalogs.{mjs,cjs}", {
    loaders: [
      {
        loader: serverCatalogLoaderPath,
        options: {
          cwd: projectRoot,
          ...(resolvedConfigPath ? { configPath: resolvedConfigPath } : {}),
        },
      },
    ],
    as: "*.js",
  });

  // Compile local .po files
  if (enablePoLoader) {
    for (const extension of ["po", "fcl"]) {
      appendTurbopackRule(rules, `*.${extension}`, {
        condition: {
          not: "foreign",
        },
        loaders: [
          {
            loader: poLoaderPath,
            options: poLoaderOptions,
          },
        ],
        as: "*.js",
      });
    }
  }

  return {
    ...baseConfig,
    ...(outputFileTracingRoot ? { outputFileTracingRoot } : {}),

    // Turbopack configuration
    turbopack: {
      ...baseConfig.turbopack,
      ...(configuredTurbopackRoot ? { root: configuredTurbopackRoot } : {}),
      ...(serverFunctionEntry
        ? {
            resolveAlias: {
              ...baseConfig.turbopack?.resolveAlias,
              [SERVER_FUNCTION_ENTRY_MODULE]: serverFunctionEntry.turbopackAlias,
            },
          }
        : {}),
      rules,
    },

    // Webpack configuration
    webpack(config, context) {
      const webpackProjectRoot = resolveProjectRoot(
        { projectRoot: explicitProjectRoot },
        baseConfig,
        context as WebpackContextWithDir,
      );
      const webpackServerFunctionEntry = resolveServerFunctionInitializer(
        serverFunctionOptions,
        webpackProjectRoot,
      );
      const webpackServerFunctions = webpackServerFunctionEntry
        ? {
            initializerModule: SERVER_FUNCTION_INITIALIZER_MODULE,
            initializerExport: SERVER_FUNCTION_INITIALIZER_EXPORT,
          }
        : undefined;
      const webpackConfigPath = resolvePalamedesConfigPath(webpackProjectRoot, configPath);
      const webpackTransformLoaderOptions = {
        runtimeModule,
        includeSourceMetadata,
        stripNonEssentialProps,
        cwd: webpackProjectRoot,
        ...(webpackConfigPath ? { configPath: webpackConfigPath } : {}),
        ...(webpackServerFunctions ? { serverFunctions: webpackServerFunctions } : {}),
      };
      const webpackPoLoaderOptions = {
        failOnMissing,
        cwd: webpackProjectRoot,
        ...(webpackConfigPath ? { configPath: webpackConfigPath } : {}),
      };
      const webpackSourceFilter = createPalamedesSourceFilter(include, exclude, {
        projectRoot: webpackProjectRoot,
      });

      if (!context.isServer) {
        config.experiments ??= {};
        config.experiments.topLevelAwait = true;
        config.output ??= {};
        config.output.environment ??= {};
        config.output.environment.asyncFunction = true;
      }

      if (webpackServerFunctionEntry) {
        config.resolve ??= {};
        if (Array.isArray(config.resolve.alias)) {
          config.resolve.alias.push({
            name: SERVER_FUNCTION_ENTRY_MODULE,
            alias: webpackServerFunctionEntry.absolutePath,
          });
        } else {
          config.resolve.alias = {
            ...config.resolve.alias,
            [SERVER_FUNCTION_ENTRY_MODULE]: webpackServerFunctionEntry.absolutePath,
          };
        }
      }

      config.module.rules.push({
        test: /[/\\]next-plugin[/\\]catalog-fragment\.cjs$/u,
        type: "javascript/auto",
        use: [{ loader: poLoaderPath, options: webpackPoLoaderOptions }],
      });

      config.module.rules.push({
        test: /[/\\]next-plugin[/\\]dist[/\\]server-catalogs\.(?:mjs|cjs)$/u,
        use: [
          {
            loader: serverCatalogLoaderPath,
            options: {
              cwd: webpackProjectRoot,
              ...(webpackConfigPath ? { configPath: webpackConfigPath } : {}),
            },
          },
        ],
      });

      // Add the OXC transform loader for JS/TS files
      config.module.rules.push({
        test: (resource: string) => webpackSourceFilter(resource),
        enforce: "pre" as const,
        use: [
          {
            loader: oxcLoaderPath,
            options: {
              ...webpackTransformLoaderOptions,
              ...(!context.isServer
                ? { clientMessageSplitting: true, clientFragmentFailureMode }
                : {}),
            },
          },
        ],
      });

      // Add .po loader. Scoped to first-party catalogs, mirroring the
      // Turbopack rule's `{ not: "foreign" }`: a dependency shipping importable
      // .po files is not a Palamedes catalog, and running it through the
      // catalog loader would fail the whole build.
      if (enablePoLoader) {
        config.module.rules.push({
          test: /\.(?:po|fcl)$/,
          exclude: /node_modules/,
          type: "javascript/auto",
          use: [
            {
              loader: poLoaderPath,
              options: webpackPoLoaderOptions,
            },
          ],
        });
      }

      // Call the original webpack function if it exists
      if (typeof baseConfig.webpack === "function") {
        return baseConfig.webpack(config, context);
      }

      return config;
    },
  };
}

export default withPalamedes;
