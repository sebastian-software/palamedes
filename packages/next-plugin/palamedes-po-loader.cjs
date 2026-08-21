"use strict"

const path = require("node:path")
const { loadPalamedesConfig } = require("@palamedes/config")
const {
  compileCatalogArtifactSelectedAsync,
  compileCatalogModuleAsync,
} = require("@palamedes/core-node")
const { createCatalogLoaderResult, createMissingErrorMessage } = require("@palamedes/transform")
const { loadConfigCached } = require("./palamedes-config-cache.cjs")
const { warnMissingAddDependency } = require("./palamedes-dev-warning.cjs")

const SELECTED_MESSAGES_QUERY = "palamedes-selected"

function resolveLoaderCwd(context, options) {
  if (typeof options.cwd === "string" && options.cwd.length > 0) {
    return path.resolve(options.cwd)
  }
  if (typeof context.rootContext === "string" && context.rootContext.length > 0) {
    return path.resolve(context.rootContext)
  }
}

module.exports = function palamedesPoLoader() {
  const callback = this.async()
  const options = typeof this.getOptions === "function" ? this.getOptions() : {}
  const failOnMissing = options.failOnMissing === true
  const failOnCompileError = options.failOnCompileError === true

  ;(async () => {
    const cfg = await loadConfigCached(
      options.configPath,
      loadPalamedesConfig,
      resolveLoaderCwd(this, options)
    )
    const locale = path.basename(this.resourcePath, ".po")
    const artifactConfig = {
      rootDir: cfg.rootDir,
      locales: cfg.locales,
      sourceLocale: cfg.sourceLocale,
      fallbackLocales: cfg.fallbackLocales,
      pseudoLocale: cfg.pseudoLocale,
      catalogs: cfg.catalogs,
    }
    const loaderOptions = {
      locale,
      pseudoLocale: cfg.pseudoLocale,
      failOnMissing,
      failOnCompileError,
      missingFailureHint:
        "You see this error because `failOnMissing=true` in Palamedes Next plugin configuration.",
      compileFailureHint:
        "These errors fail the build because `failOnCompileError=true` in the Palamedes Next plugin configuration.",
      diagnosticsWarningHint:
        "You can fail the build on error diagnostics by setting `failOnCompileError=true` in the Palamedes Next plugin configuration.",
    }
    const selection = new URLSearchParams(this.resourceQuery ?? "").get(SELECTED_MESSAGES_QUERY)
    let result
    if (selection) {
      const compiledIds = JSON.parse(Buffer.from(selection, "base64url").toString("utf8"))
      if (!Array.isArray(compiledIds) || !compiledIds.every((id) => typeof id === "string")) {
        throw new TypeError("Invalid Palamedes selected-message query.")
      }
      const artifact = await compileCatalogArtifactSelectedAsync(
        artifactConfig,
        this.resourcePath,
        compiledIds
      )
      result = {
        ...createCatalogLoaderResult(artifact, loaderOptions),
        watchFiles: artifact.watchFiles,
      }
      const resolvedLocale = artifact.resolvedLocaleChain?.[0] ?? locale
      if (!failOnMissing && resolvedLocale !== cfg.pseudoLocale && artifact.missing.length > 0) {
        result.warnings.push(createMissingErrorMessage(resolvedLocale, artifact.missing))
      }
    } else {
      result = await compileCatalogModuleAsync(artifactConfig, this.resourcePath, loaderOptions)
    }
    if (typeof this.addDependency === "function") {
      if (cfg.configPath) {
        this.addDependency(cfg.configPath)
      }
      result.watchFiles.forEach((file) => {
        this.addDependency(file)
      })
    } else if (selection) {
      // Selected artifacts fold fallback catalogs into a split sidecar. Without
      // addDependency a host cannot invalidate those indirect inputs.
      warnMissingAddDependency(this)
    }

    result.warnings.forEach((warning) => {
      // emitWarning reaches the Next overlay and webpack's deduplicated
      // diagnostics; console.warn repeated on every rebuild instead.
      if (typeof this.emitWarning === "function") {
        this.emitWarning(new Error(warning))
      } else {
        console.warn(warning)
      }
    })

    callback(null, result.code, null)
  })().catch((error) => {
    callback(error)
  })
}
