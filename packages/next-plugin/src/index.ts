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

import { PALAMEDES_MACRO_PACKAGES } from "@palamedes/transform"

const require = createRequire(import.meta.url)

type TurbopackRules = NonNullable<NonNullable<NextConfig["turbopack"]>["rules"]>
type TurbopackRuleConfigItem = Extract<TurbopackRules[string], { loaders?: unknown }>

/*
 * Derived from the canonical macro package list so the content pre-filter can
 * never drift from the transform (it previously omitted @palamedes/solid/macro).
 */
const MACRO_CONTENT_PATTERN = new RegExp(
  PALAMEDES_MACRO_PACKAGES.map((name) => name.replaceAll(/[.*+?^${}()|[\]\\/]/gu, "\\$&")).join("|")
)

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
  rules[glob] = Array.isArray(existing) ? [...existing, rule] : [existing, rule]
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
   * Module to import the runtime getter from.
   * @default "@palamedes/runtime"
   */
  runtimeModule?: string

  /**
   * Monorepo workspace root to use for Turbopack and output file tracing.
   * If omitted, Palamedes will try to detect a workspace root from process.cwd().
   */
  workspaceRoot?: string
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
    runtimeModule = "@palamedes/runtime",
    workspaceRoot: explicitWorkspaceRoot,
  } = options

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

  const rules: TurbopackRules = { ...baseConfig.turbopack?.rules }

  // Transform local JS/TS files that actually import Palamedes macros. The
  // include/exclude options translate into the rule condition so they behave
  // the same under Turbopack as in the webpack branch below.
  appendTurbopackRule(rules, "*", {
    condition: {
      all: [
        { not: "foreign" },
        { path: include },
        { not: { path: exclude } },
        { content: MACRO_CONTENT_PATTERN },
      ],
    },
    loaders: [
      {
        loader: oxcLoaderPath,
        options: { runtimeModule },
      },
    ],
  })

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
      rules,
    },

    // Webpack configuration
    webpack(config, context) {
      // Add the OXC transform loader for JS/TS files
      config.module.rules.push({
        test: include,
        exclude,
        enforce: "pre" as const,
        use: [
          {
            loader: oxcLoaderPath,
            options: { runtimeModule },
          },
        ],
      })

      // Add .po loader
      if (enablePoLoader) {
        config.module.rules.push({
          test: /\.po$/,
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
