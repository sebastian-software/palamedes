/**
 * @palamedes/next-plugin
 *
 * Next.js integration for Palamedes using OXC-based macro transformation.
 * No Babel required!
 */

import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
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
   * If not provided, searches for config automatically.
   */
  configPath?: string

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
   * If omitted, Palamedes will try to detect a workspace root from process.cwd().
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

function resolveServerFunctionInitializer(enabled: boolean | undefined) {
  if (!enabled) return

  const projectRoot = process.cwd()
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

function resolveWorkspaceRoot(explicitRoot?: string) {
  if (explicitRoot) {
    return explicitRoot
  }

  let currentDir = process.cwd()
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
    workspaceRoot: explicitWorkspaceRoot,
    serverFunctions: serverFunctionOptions,
    messageSplitting = false,
  } = options

  const runtimeModule = resolveMacroRuntimeModule(explicitRuntimeModule)
  const keepSourceFallbacks = explicitKeepSourceFallbacks ?? process.env.NODE_ENV !== "production"
  const stripNonEssentialProps = process.env.NODE_ENV === "production"
  const serverFunctionEntry = resolveServerFunctionInitializer(serverFunctionOptions)
  const serverFunctions = serverFunctionEntry
    ? {
        initializerModule: SERVER_FUNCTION_INITIALIZER_MODULE,
        initializerExport: SERVER_FUNCTION_INITIALIZER_EXPORT,
      }
    : undefined
  const workspaceRoot = resolveWorkspaceRoot(explicitWorkspaceRoot)
  const configuredTurbopackRoot = baseConfig.turbopack?.root ?? workspaceRoot
  const outputFileTracingRoot =
    baseConfig.outputFileTracingRoot ??
    (typeof configuredTurbopackRoot === "string" ? configuredTurbopackRoot : undefined)

  // Resolve loader paths
  const oxcLoaderPath = require.resolve("@palamedes/next-plugin/palamedes-loader")
  const poLoaderPath = require.resolve("@palamedes/next-plugin/palamedes-po-loader")
  const poLoaderOptions = {
    failOnMissing,
    failOnCompileError,
    ...(configPath ? { configPath } : {}),
  }
  const transformLoaderOptions = {
    runtimeModule,
    keepSourceFallbacks,
    stripNonEssentialProps,
    ...(configPath ? { configPath } : {}),
    ...(serverFunctions ? { serverFunctions } : {}),
  }

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
            ...(messageSplitting ? { clientMessageSplitting: true } : {}),
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
      if (messageSplitting && !context.isServer) {
        config.experiments ??= {}
        config.experiments.topLevelAwait = true
        config.output ??= {}
        config.output.environment ??= {}
        config.output.environment.asyncFunction = true
      }

      if (serverFunctionEntry) {
        config.resolve ??= {}
        if (Array.isArray(config.resolve.alias)) {
          config.resolve.alias.push({
            name: SERVER_FUNCTION_ENTRY_MODULE,
            alias: serverFunctionEntry.absolutePath,
          })
        } else {
          config.resolve.alias = {
            ...config.resolve.alias,
            [SERVER_FUNCTION_ENTRY_MODULE]: serverFunctionEntry.absolutePath,
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
              ...transformLoaderOptions,
              ...(serverFunctions && context.isServer ? { serverMessageSplitting: true } : {}),
              ...(messageSplitting && !context.isServer ? { clientMessageSplitting: true } : {}),
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
              options: poLoaderOptions,
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
