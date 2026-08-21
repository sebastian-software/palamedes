/**
 * @palamedes/next-plugin
 *
 * Next.js integration for Palamedes using OXC-based macro transformation.
 * No Babel required!
 */

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import type { NextConfig } from "next"

import { PALAMEDES_MACRO_PACKAGES, resolveMacroRuntimeModule } from "@palamedes/transform"

const require = createRequire(import.meta.url)

type TurbopackRules = NonNullable<NonNullable<NextConfig["turbopack"]>["rules"]>
type TurbopackRuleConfigItem = Extract<TurbopackRules[string], { loaders?: unknown }>
type TurbopackRuleCollectionEntry = Extract<TurbopackRules[string], unknown[]>[number]
type TurbopackLoaderItem = Exclude<TurbopackRuleConfigItem["loaders"], undefined>[number]

/*
 * Derived from the canonical macro package list so the content pre-filter can
 * never drift from the transform (it previously omitted @palamedes/solid/macro).
 */
const MACRO_CONTENT_PATTERN = new RegExp(
  PALAMEDES_MACRO_PACKAGES.map((name) => name.replaceAll(/[.*+?^${}()|[\]\\/]/gu, "\\$&")).join("|")
)
const SERVER_FUNCTION_CONTENT_PATTERN = /["']use server["']/
const SERVER_FUNCTION_INITIALIZER_MODULE = "@palamedes/next-plugin/server-function-initializer"
const SERVER_FUNCTION_ENTRY_MODULE = "@palamedes/next-plugin/server-function-entry"
const SERVER_FUNCTION_INITIALIZER_EXPORT = "initializeServerFunctionI18n"
const SERVER_FUNCTION_ENTRY_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
] as const

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
  )
}

function normalizeTurbopackRuleCollection(
  entries: readonly TurbopackRuleCollectionEntry[]
): TurbopackRuleConfigItem[] {
  const normalized: TurbopackRuleConfigItem[] = []
  let pendingLoaders: TurbopackLoaderItem[] = []

  const flushLoaders = (): void => {
    if (pendingLoaders.length > 0) {
      normalized.push({ loaders: pendingLoaders })
      pendingLoaders = []
    }
  }

  for (const entry of entries) {
    if (isTurbopackLoaderItem(entry)) {
      // Loader order within a shorthand run is significant; keep the run intact.
      pendingLoaders.push(entry)
      continue
    }
    flushLoaders()
    normalized.push(entry)
  }
  flushLoaders()

  return normalized
}

/*
 * Turbopack rules are keyed by glob; a glob can carry a list of rule configs.
 * Appending keeps user-supplied rules for the same glob intact instead of
 * silently overwriting them.
 */
function appendTurbopackRule(
  rules: TurbopackRules,
  glob: string,
  rule: TurbopackRuleConfigItem
): void {
  const existing = rules[glob]
  if (existing === undefined) {
    rules[glob] = rule
    return
  }
  rules[glob] = Array.isArray(existing)
    ? [...normalizeTurbopackRuleCollection(existing), rule]
    : [existing, rule]
}

export type WithPalamedesOptions = {
  /**
   * Pattern to include files for transformation.
   * @default /\.(tsx?|jsx?)$/
   */
  include?: RegExp

  /**
   * Pattern to exclude files from transformation.
   * @default /node_modules/
   */
  exclude?: RegExp

  /**
   * Enable .po file compilation loader.
   * @default true
   */
  enablePoLoader?: boolean

  /**
   * Path to a Palamedes config file.
   * Relative paths resolve from the Next project root. If not provided,
   * Palamedes searches for config automatically from that root.
   */
  configPath?: string

  /**
   * Absolute or relative Next project directory. Set this when Next's project
   * directory cannot be derived automatically, for example in a custom host.
   * `cwd` is an alias for compatibility with loader terminology.
   */
  projectRoot?: string

  /** @deprecated Use projectRoot instead. */
  cwd?: string

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
   * Advanced override for the module that exports the runtime getter.
   * @default "@palamedes/runtime"
   */
  runtimeModule?: string

  /**
   * Preserve authored source messages as runtime fallbacks.
   * Defaults to `true` in development and `false` in production.
   */
  keepSourceFallbacks?: boolean

  /**
   * Monorepo workspace root to use for Turbopack and output file tracing.
   * If omitted, Palamedes will try to detect a workspace root from the Next
   * project root.
   */
  workspaceRoot?: string

  /**
   * Initialize request-local i18n at the start of every recognized Next.js
   * Server Function. Requires a `palamedes.server` entry module exporting
   * `initializeServerFunctionI18n`.
   *
   * @default false
   */
  serverFunctions?: boolean

  /**
   * Split client messages with the Next.js module graph. Each transformed
   * browser module loads only its own compiled fragment for the document
   * locale before evaluating its body or resolving to importers.
   *
   * @default false
   */
  messageSplitting?: boolean
}

function resolveServerFunctionInitializer(enabled: boolean | undefined, projectRoot: string) {
  if (!enabled) return

  const candidates = ["src", ""].flatMap((directory) =>
    SERVER_FUNCTION_ENTRY_EXTENSIONS.map((extension) =>
      path.join(projectRoot, directory, `palamedes.server${extension}`)
    )
  )
  const matches = candidates.filter((candidate) => existsSync(candidate))

  if (matches.length === 0) {
    throw new Error(
      "Palamedes Server Function instrumentation requires a palamedes.server module in the project root or src directory. Export initializeServerFunctionI18n from that module."
    )
  }
  if (matches.length > 1) {
    throw new Error(
      `Palamedes found multiple Server Function entry modules: ${matches.join(", ")}. Keep exactly one palamedes.server module.`
    )
  }

  return {
    absolutePath: matches[0]!,
    turbopackAlias: `./${path.relative(projectRoot, matches[0]!).split(path.sep).join("/")}`,
  }
}

function resolveWorkspaceRoot(projectRoot: string, explicitRoot?: string) {
  if (explicitRoot) {
    return path.resolve(projectRoot, explicitRoot)
  }

  let currentDir = projectRoot
  const initialDir = currentDir

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json")

    if (
      hasWorkspaces(packageJsonPath) ||
      existsSync(path.join(currentDir, "pnpm-workspace.yaml")) ||
      existsSync(path.join(currentDir, "turbo.json")) ||
      existsSync(path.join(currentDir, ".git"))
    ) {
      return currentDir === initialDir ? undefined : currentDir
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) {
      return
    }
    currentDir = parentDir
  }
}

type NextConfigWithResolvedPath = NextConfig & { configFile?: string }
type WebpackContextWithDir = { dir?: unknown }

function resolveProjectRoot(
  options: Pick<WithPalamedesOptions, "projectRoot" | "cwd">,
  baseConfig: NextConfig,
  context?: WebpackContextWithDir
): string {
  const explicitProjectRoot = options.projectRoot
  const explicitCwd = options.cwd
  if (explicitProjectRoot && explicitCwd) {
    const projectRoot = path.resolve(explicitProjectRoot)
    const cwd = path.resolve(explicitCwd)
    if (projectRoot !== cwd) {
      throw new TypeError("withPalamedes projectRoot and cwd must resolve to the same directory.")
    }
  }
  if (explicitProjectRoot || explicitCwd) {
    return path.resolve(explicitProjectRoot ?? explicitCwd!)
  }

  if (typeof context?.dir === "string" && context.dir.length > 0) {
    return path.resolve(context.dir)
  }

  const configFile = (baseConfig as NextConfigWithResolvedPath).configFile
  if (typeof configFile === "string" && configFile.length > 0) {
    return path.dirname(path.resolve(configFile))
  }

  const configProjectRoot = resolveNextConfigProjectRoot()
  if (configProjectRoot) {
    return configProjectRoot
  }

  const cliProjectRoot = resolveNextCliProjectRoot()
  if (cliProjectRoot) {
    return cliProjectRoot
  }

  return process.cwd()
}

function resolveNextConfigProjectRoot(): string | undefined {
  const stack = new Error("Resolve the Next config evaluation stack.").stack
  if (!stack) {
    return
  }

  for (const frame of stack.split("\n")) {
    const configFile = nextConfigFileFromStackFrame(frame)
    if (configFile) {
      return path.dirname(configFile)
    }
  }
}

function nextConfigFileFromStackFrame(frame: string): string | undefined {
  const configFileName = frame.match(/next\.config\.(?:[cm]?[jt]s)/u)?.[0]
  if (!configFileName) {
    return
  }

  const configFileEnd = frame.indexOf(configFileName) + configFileName.length
  const prefix = frame.slice(0, configFileEnd)
  const openingParenthesis = prefix.lastIndexOf("(")
  const rawPath = prefix
    .slice(openingParenthesis === -1 ? 0 : openingParenthesis + 1)
    .trim()
    .replace(/^at\s+(?:async\s+)?/u, "")

  if (!rawPath) {
    return
  }

  return rawPath.startsWith("file:") ? fileURLToPath(rawPath) : path.resolve(rawPath)
}

function resolveNextCliProjectRoot(): string | undefined {
  const commandIndex = process.argv.findIndex((argument) =>
    ["dev", "build", "start"].includes(argument)
  )
  if (commandIndex === -1) {
    return
  }

  const directory = process.argv[commandIndex + 1]
  if (!directory || directory.startsWith("-")) {
    return
  }

  return path.resolve(directory)
}

function hasWorkspaces(packageJsonPath: string) {
  if (!existsSync(packageJsonPath)) {
    return false
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      workspaces?: unknown
    }

    if (Array.isArray(packageJson.workspaces)) {
      return packageJson.workspaces.length > 0
    }

    if (
      packageJson.workspaces &&
      typeof packageJson.workspaces === "object" &&
      Array.isArray((packageJson.workspaces as { packages?: unknown }).packages)
    ) {
      return (packageJson.workspaces as { packages: unknown[] }).packages.length > 0
    }

    return false
  } catch {
    return false
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
  options: WithPalamedesOptions = {}
): NextConfig {
  const {
    include = /\.[jt]sx?$/,
    exclude = /node_modules/,
    enablePoLoader = true,
    configPath,
    failOnMissing = false,
    failOnCompileError = false,
    runtimeModule: explicitRuntimeModule,
    keepSourceFallbacks: explicitKeepSourceFallbacks,
    projectRoot: explicitProjectRoot,
    cwd: explicitCwd,
    workspaceRoot: explicitWorkspaceRoot,
    serverFunctions: serverFunctionOptions,
    messageSplitting = false,
  } = options

  const runtimeModule = resolveMacroRuntimeModule(explicitRuntimeModule)
  // Production catalog chunks can lag code during a deploy or be loaded
  // independently when message splitting is enabled. Preserve source text by
  // default so a miss is readable rather than a compiled hash; applications
  // with stricter source-text or bundle-size constraints can opt out.
  const keepSourceFallbacks = explicitKeepSourceFallbacks ?? true
  const stripNonEssentialProps = process.env.NODE_ENV === "production"
  const projectRoot = resolveProjectRoot(
    { projectRoot: explicitProjectRoot, cwd: explicitCwd },
    baseConfig
  )
  const resolvedConfigPath = configPath ? path.resolve(projectRoot, configPath) : undefined
  const serverFunctionEntry = resolveServerFunctionInitializer(serverFunctionOptions, projectRoot)
  const serverFunctions = serverFunctionEntry
    ? {
        initializerModule: SERVER_FUNCTION_INITIALIZER_MODULE,
        initializerExport: SERVER_FUNCTION_INITIALIZER_EXPORT,
      }
    : undefined
  const workspaceRoot = resolveWorkspaceRoot(projectRoot, explicitWorkspaceRoot)
  const configuredTurbopackRoot =
    typeof baseConfig.turbopack?.root === "string"
      ? path.resolve(projectRoot, baseConfig.turbopack.root)
      : workspaceRoot
  const outputFileTracingRoot =
    baseConfig.outputFileTracingRoot ??
    (typeof configuredTurbopackRoot === "string" ? configuredTurbopackRoot : undefined)

  // Resolve loader paths
  const oxcLoaderPath = require.resolve("@palamedes/next-plugin/palamedes-loader")
  const poLoaderPath = require.resolve("@palamedes/next-plugin/palamedes-po-loader")
  const poLoaderOptions = {
    failOnMissing,
    failOnCompileError,
    cwd: projectRoot,
    ...(resolvedConfigPath ? { configPath: resolvedConfigPath } : {}),
  }
  const transformLoaderOptions = {
    runtimeModule,
    keepSourceFallbacks,
    stripNonEssentialProps,
    cwd: projectRoot,
    ...(resolvedConfigPath ? { configPath: resolvedConfigPath } : {}),
    ...(serverFunctions ? { serverFunctions } : {}),
  }
  // A missing production chunk must not make the entire client entry module
  // unevaluable. Development stays fail-fast so broken catalog wiring is
  // surfaced immediately instead of being hidden behind source fallbacks.
  const clientFragmentFailureMode = process.env.NODE_ENV === "production" ? "degrade" : "throw"

  const rules: TurbopackRules = { ...baseConfig.turbopack?.rules }

  // Transform local JS/TS files that actually import Palamedes macros. The
  // include/exclude options translate into the rule condition so they behave
  // the same under Turbopack as in the webpack branch below.
  const transformConditions = [
    { not: "foreign" },
    { path: include },
    { not: { path: exclude } },
    {
      content: serverFunctions
        ? new RegExp(`${MACRO_CONTENT_PATTERN.source}|${SERVER_FUNCTION_CONTENT_PATTERN.source}`)
        : MACRO_CONTENT_PATTERN,
    },
  ]
  if (serverFunctions || messageSplitting) {
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
            ...(messageSplitting
              ? { clientMessageSplitting: true, clientFragmentFailureMode }
              : {}),
          },
        },
      ],
    })
    appendTurbopackRule(rules, "*", {
      condition: { all: [...transformConditions, { not: "browser" }] },
      loaders: [
        {
          loader: oxcLoaderPath,
          options: {
            ...transformLoaderOptions,
            ...(serverFunctions ? { serverMessageSplitting: true } : {}),
          },
        },
      ],
    })
  } else {
    appendTurbopackRule(rules, "*", {
      condition: { all: transformConditions },
      loaders: [{ loader: oxcLoaderPath, options: transformLoaderOptions }],
    })
  }

  // Compile local .po files
  if (enablePoLoader) {
    appendTurbopackRule(rules, "*.po", {
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
    })
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
        { projectRoot: explicitProjectRoot, cwd: explicitCwd },
        baseConfig,
        context as WebpackContextWithDir
      )
      const webpackServerFunctionEntry = resolveServerFunctionInitializer(
        serverFunctionOptions,
        webpackProjectRoot
      )
      const webpackServerFunctions = webpackServerFunctionEntry
        ? {
            initializerModule: SERVER_FUNCTION_INITIALIZER_MODULE,
            initializerExport: SERVER_FUNCTION_INITIALIZER_EXPORT,
          }
        : undefined
      const webpackTransformLoaderOptions = {
        runtimeModule,
        keepSourceFallbacks,
        stripNonEssentialProps,
        cwd: webpackProjectRoot,
        ...(configPath ? { configPath: path.resolve(webpackProjectRoot, configPath) } : {}),
        ...(webpackServerFunctions ? { serverFunctions: webpackServerFunctions } : {}),
      }
      const webpackPoLoaderOptions = {
        failOnMissing,
        failOnCompileError,
        cwd: webpackProjectRoot,
        ...(configPath ? { configPath: path.resolve(webpackProjectRoot, configPath) } : {}),
      }

      if (messageSplitting && !context.isServer) {
        config.experiments ??= {}
        config.experiments.topLevelAwait = true
        config.output ??= {}
        config.output.environment ??= {}
        config.output.environment.asyncFunction = true
      }

      if (webpackServerFunctionEntry) {
        config.resolve ??= {}
        if (Array.isArray(config.resolve.alias)) {
          config.resolve.alias.push({
            name: SERVER_FUNCTION_ENTRY_MODULE,
            alias: webpackServerFunctionEntry.absolutePath,
          })
        } else {
          config.resolve.alias = {
            ...config.resolve.alias,
            [SERVER_FUNCTION_ENTRY_MODULE]: webpackServerFunctionEntry.absolutePath,
          }
        }
      }

      // Add the OXC transform loader for JS/TS files
      config.module.rules.push({
        test: include,
        exclude,
        enforce: "pre" as const,
        use: [
          {
            loader: oxcLoaderPath,
            options: {
              ...webpackTransformLoaderOptions,
              ...(webpackServerFunctions && context.isServer
                ? { serverMessageSplitting: true }
                : {}),
              ...(messageSplitting && !context.isServer
                ? { clientMessageSplitting: true, clientFragmentFailureMode }
                : {}),
            },
          },
        ],
      })

      // Add .po loader. Scoped to first-party catalogs, mirroring the
      // Turbopack rule's `{ not: "foreign" }`: a dependency shipping importable
      // .po files is not a Palamedes catalog, and running it through the
      // catalog loader would fail the whole build.
      if (enablePoLoader) {
        config.module.rules.push({
          test: /\.po$/,
          exclude: /node_modules/,
          type: "javascript/auto",
          use: [
            {
              loader: poLoaderPath,
              options: webpackPoLoaderOptions,
            },
          ],
        })
      }

      // Call the original webpack function if it exists
      if (typeof baseConfig.webpack === "function") {
        return baseConfig.webpack(config, context)
      }

      return config
    },
  }
}

export default withPalamedes
