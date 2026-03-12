"use strict";

const path = require("node:path");
const { loadPalamedesConfig } = require("@palamedes/config");
const { getCatalogModule } = require("@palamedes/core-node");

function createMissingErrorMessage(locale, missingMessages) {
  const lines = missingMessages.map((missing) => `${missing.id}: ${missing.source}`);
  return `Failed to compile catalog for locale ${locale}!\n\nMissing ${missingMessages.length} translation(s):\n${lines.join("\n")}`;
}

function createCompilationErrorMessage(locale, errors) {
  const lines = errors.map((error) =>
    error.id ? `${error.id}\nReason: ${error.message}` : error.message
  );
  return `Failed to compile catalog for locale ${locale}!\n\nCompilation error for ${errors.length} translation(s):\n${lines.join("\n\n")}`;
}

module.exports = function palamedesPoLoader() {
  const callback = this.async();
  const options = typeof this.getOptions === "function" ? this.getOptions() : {};
  const failOnMissing = options.failOnMissing === true;
  const failOnCompileError = options.failOnCompileError === true;

  (async () => {
    const cfg = await loadPalamedesConfig({ configPath: options.configPath });
    const result = getCatalogModule(
      {
        rootDir: cfg.rootDir,
        locales: cfg.locales,
        sourceLocale: cfg.sourceLocale,
        fallbackLocales: cfg.fallbackLocales,
        pseudoLocale: cfg.pseudoLocale,
        catalogs: cfg.catalogs,
      },
      this.resourcePath
    );
    const locale = path.basename(this.resourcePath, ".po");
    result.watchFiles.forEach((file) => {
      if (typeof this.addDependency === "function") {
        this.addDependency(file);
      }
    });

    if (locale !== cfg.pseudoLocale && result.missing.length > 0 && failOnMissing) {
      throw new Error(createMissingErrorMessage(locale, result.missing));
    }

    if (result.errors.length > 0) {
      const message = createCompilationErrorMessage(locale, result.errors);

      if (failOnCompileError) {
        throw new Error(message);
      }

      console.warn(message);
    }

    callback(null, result.code, null);
  })().catch((error) => {
    callback(error);
  });
};
