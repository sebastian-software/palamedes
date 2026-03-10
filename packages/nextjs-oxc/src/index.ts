/**
 * @palamedes/next
 *
 * Next.js integration for Lingui using OXC-based macro transformation.
 * No Babel required!
 */

import { createRequire } from "node:module"
import type { NextConfig } from "next"

const require = createRequire(import.meta.url)

export interface WithLinguiOxcOptions {
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
   * Path to lingui.config.js.
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
}

/**
 * Wraps a Next.js config to add Lingui OXC transformation.
 *
 * @example
 * ```js
 * // next.config.js
 * const { withLinguiOxc } = require("@palamedes/next")
 *
 * module.exports = withLinguiOxc({
 *   // your existing next config
 * })
 * ```
 */
export function withLinguiOxc(
  baseConfig: NextConfig = {},
  options: WithLinguiOxcOptions = {}
): NextConfig {
  const {
    include = /\.[jt]sx?$/,
    exclude = /node_modules/,
    enablePoLoader = true,
    configPath,
    failOnMissing = false,
    failOnCompileError = false,
    runtimeModule = "@palamedes/runtime",
  } = options

  // Resolve loader paths
  const oxcLoaderPath = require.resolve(
    "@palamedes/next/lingui-oxc-loader"
  )
  const poLoaderPath = require.resolve(
    "@palamedes/next/lingui-po-loader"
  )

  return {
    ...baseConfig,

    // Turbopack configuration
    turbopack: {
      ...baseConfig.turbopack,
      rules: {
        ...baseConfig.turbopack?.rules,
        // Transform JS/TS files with OXC loader
        "*.{js,jsx,ts,tsx}": {
          loaders: [
            {
              loader: oxcLoaderPath,
              options: { runtimeModule },
            },
          ],
        },
        // Compile .po files
        ...(enablePoLoader && {
          "*.po": {
            loaders: [
              {
                loader: poLoaderPath,
                options: { configPath, failOnMissing, failOnCompileError },
              },
            ],
            as: "*.js",
          },
        }),
      },
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
              options: { configPath, failOnMissing, failOnCompileError },
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

export default withLinguiOxc
