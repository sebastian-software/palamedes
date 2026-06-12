"use strict"

const path = require("node:path")
const { loadPalamedesConfig } = require("@palamedes/config")
const { compileCatalogArtifact } = require("@palamedes/core-node")
const { createCatalogLoaderResult } = require("@palamedes/transform/catalog-loader")

module.exports = function palamedesPoLoader() {
  const callback = this.async()
  const options = typeof this.getOptions === "function" ? this.getOptions() : {}
  const failOnMissing = options.failOnMissing === true
  const failOnCompileError = options.failOnCompileError === true

  ;(async () => {
    const cfg = await loadPalamedesConfig({ configPath: options.configPath })
    const result = compileCatalogArtifact(
      {
        rootDir: cfg.rootDir,
        locales: cfg.locales,
        sourceLocale: cfg.sourceLocale,
        fallbackLocales: cfg.fallbackLocales,
        pseudoLocale: cfg.pseudoLocale,
        catalogs: cfg.catalogs,
      },
      this.resourcePath
    )
    const locale = path.basename(this.resourcePath, ".po")
    result.watchFiles.forEach((file) => {
      if (typeof this.addDependency === "function") {
        this.addDependency(file)
      }
    })

    const loaderResult = createCatalogLoaderResult(result, {
      locale,
      pseudoLocale: cfg.pseudoLocale,
      failOnMissing,
      failOnCompileError,
      diagnosticsWarningHint:
        "You can fail the build on error diagnostics by setting `failOnCompileError=true` in the Palamedes Next plugin configuration.",
    })

    loaderResult.warnings.forEach((warning) => console.warn(warning))

    callback(null, loaderResult.code, null)
  })().catch((error) => {
    callback(error)
  })
}
