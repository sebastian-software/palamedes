"use strict";

const path = require("node:path");
const { getConfig } = require("@lingui/conf");
const {
  createCompiledCatalog,
  getCatalogs,
  getCatalogForFile,
  createMissingErrorMessage,
  createCompilationErrorMessage,
} = require("@lingui/cli/api");

module.exports = function linguiPoLoader() {
  const callback = this.async();
  const options = typeof this.getOptions === "function" ? this.getOptions() : {};
  const failOnMissing = options.failOnMissing === true;
  const failOnCompileError = options.failOnCompileError === true;

  (async () => {
    const cfg = getConfig({ configPath: options.configPath });
    const catalogRelativePath = path.relative(cfg.rootDir, this.resourcePath);
    const fileCatalog = getCatalogForFile(
      catalogRelativePath,
      await getCatalogs(cfg)
    );

    if (!fileCatalog) {
      throw new Error(
        `Requested resource ${catalogRelativePath} is not matched to any of your catalogs paths specified in "lingui.config".\n\n` +
          `Resource: ${this.resourcePath}\n\n` +
          `Your catalogs:\n${cfg.catalogs.map((catalog) => catalog.path).join("\n")}\n\n` +
          "Please check that catalogs.path is filled properly."
      );
    }

    const { locale, catalog } = fileCatalog;
    const { messages, missing: missingMessages } = await catalog.getTranslations(
      locale,
      {
        fallbackLocales: cfg.fallbackLocales,
        sourceLocale: cfg.sourceLocale,
      }
    );

    if (locale !== cfg.pseudoLocale && missingMessages.length > 0 && failOnMissing) {
      throw new Error(createMissingErrorMessage(locale, missingMessages, "loader"));
    }

    const { source, errors } = createCompiledCatalog(locale, messages, {
      namespace: "es",
      pseudoLocale: cfg.pseudoLocale,
    });

    if (errors.length > 0) {
      const message = createCompilationErrorMessage(locale, errors);

      if (failOnCompileError) {
        throw new Error(message);
      }

      console.warn(message);
    }

    callback(null, source, null);
  })().catch((error) => {
    callback(error);
  });
};
