"use strict"

const path = require("node:path")
const { loadPalamedesConfig } = require("@palamedes/config")
const { compileCatalogModule } = require("@palamedes/core-node")

module.exports = function palamedesPoLoader() {
  const callback = this.async()
  const options = typeof this.getOptions === "function" ? this.getOptions() : {}
  const failOnMissing = options.failOnMissing === true
  const failOnCompileError = options.failOnCompileError === true

  ;(async () => {
    const cfg = await loadPalamedesConfig({ configPath: options.configPath })
    const locale = path.basename(this.resourcePath, ".po")
    const result = compileCatalogModule(
      {
        rootDir: cfg.rootDir,
        locales: cfg.locales,
        sourceLocale: cfg.sourceLocale,
        fallbackLocales: cfg.fallbackLocales,
        pseudoLocale: cfg.pseudoLocale,
        catalogs: cfg.catalogs,
      },
      this.resourcePath,
      {
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
    )
    result.watchFiles.forEach((file) => {
      if (typeof this.addDependency === "function") {
        this.addDependency(file)
      }
    })

    result.warnings.forEach((warning) => console.warn(warning))

    callback(null, result.code, null)
  })().catch((error) => {
    callback(error)
  })
}
