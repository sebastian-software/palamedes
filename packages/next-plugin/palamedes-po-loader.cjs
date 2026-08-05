"use strict"

const { statSync } = require("node:fs")
const path = require("node:path")
const { loadPalamedesConfig } = require("@palamedes/config")
const { compileCatalogArtifactSelected, compileCatalogModule } = require("@palamedes/core-node")
const { createCatalogLoaderResult, createMissingErrorMessage } = require("@palamedes/transform")

const SELECTED_MESSAGES_QUERY = "palamedes-selected"

/*
 * Loading the config walks the filesystem upward and parses the file; doing
 * that once per .po file per rebuild is wasteful. Cache per requested path
 * and invalidate on config-file mtime changes, so webpack rebuilds triggered
 * by the addDependency below observe the edited config.
 */
const configCache = new Map()

async function loadConfigCached(configPath) {
  const key = configPath ?? ""
  const cached = configCache.get(key)
  if (cached) {
    try {
      if (statSync(cached.cfg.configPath).mtimeMs === cached.mtimeMs) {
        return cached.cfg
      }
    } catch {
      // Config file moved or deleted — fall through to a fresh load.
    }
  }
  const cfg = await loadPalamedesConfig({ configPath })
  try {
    configCache.set(key, { cfg, mtimeMs: statSync(cfg.configPath).mtimeMs })
  } catch {
    // Config not stat-able (e.g. stubbed in tests) — serve it uncached.
  }
  return cfg
}

module.exports = function palamedesPoLoader() {
  const callback = this.async()
  const options = typeof this.getOptions === "function" ? this.getOptions() : {}
  const failOnMissing = options.failOnMissing === true
  const failOnCompileError = options.failOnCompileError === true

  ;(async () => {
    const cfg = await loadConfigCached(options.configPath)
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
      const artifact = compileCatalogArtifactSelected(
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
      result = compileCatalogModule(artifactConfig, this.resourcePath, loaderOptions)
    }
    if (typeof this.addDependency === "function") {
      if (cfg.configPath) {
        this.addDependency(cfg.configPath)
      }
      result.watchFiles.forEach((file) => {
        this.addDependency(file)
      })
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
