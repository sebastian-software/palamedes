"use strict";

const path = require("node:path");
const { loadPalamedesConfig } = require("@palamedes/config");
const { compileCatalogArtifact } = require("@palamedes/core-node");

function createMissingErrorMessage(locale, missingMessages) {
  const lines = missingMessages.map((missing) =>
    missing.sourceKey.context
      ? `${missing.sourceKey.message} [context: ${missing.sourceKey.context}]`
      : missing.sourceKey.message
  );
  return `Failed to compile catalog for locale ${locale}!\n\nMissing ${missingMessages.length} translation(s):\n${lines.join("\n")}`;
}

function createDiagnosticMessage(locale, diagnostics) {
  const lines = diagnostics.map((diagnostic) => {
    const source = diagnostic.sourceKey.context
      ? `${diagnostic.sourceKey.message} [context: ${diagnostic.sourceKey.context}]`
      : diagnostic.sourceKey.message;
    return `[${diagnostic.severity}] ${diagnostic.code} (${diagnostic.locale})\n${diagnostic.message}\nSource: ${source}`;
  });
  return `Catalog diagnostics for locale ${locale}:\n\n${lines.join("\n\n")}`;
}

function createCompileErrorMessage(locale, diagnostics) {
  const lines = diagnostics.map((diagnostic) => {
    const source = diagnostic.sourceKey.context
      ? `${diagnostic.sourceKey.message} [context: ${diagnostic.sourceKey.context}]`
      : diagnostic.sourceKey.message;
    return `${diagnostic.message}\nCode: ${diagnostic.code}\nLocale: ${diagnostic.locale}\nSource: ${source}`;
  });
  return `Failed to compile catalog for locale ${locale}!\n\nCompilation error for ${diagnostics.length} translation(s):\n${lines.join("\n\n")}`;
}

function warnDiagnostics(locale, diagnostics) {
  if (diagnostics.length === 0) {
    return;
  }

  console.warn(
    `${createDiagnosticMessage(locale, diagnostics)}\n\nYou can fail the build on error diagnostics by setting \`failOnCompileError=true\` in the Palamedes Next plugin configuration.`
  );
}

function renderCatalogModule(messages) {
  return `export const messages=${JSON.stringify(messages)};export default { messages };`;
}

module.exports = function palamedesPoLoader() {
  const callback = this.async();
  const options = typeof this.getOptions === "function" ? this.getOptions() : {};
  const failOnMissing = options.failOnMissing === true;
  const failOnCompileError = options.failOnCompileError === true;

  (async () => {
    const cfg = await loadPalamedesConfig({ configPath: options.configPath });
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

    if (result.diagnostics.length > 0) {
      const errorDiagnostics = result.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error"
      );

      if (failOnCompileError && errorDiagnostics.length > 0) {
        const message = createCompileErrorMessage(locale, errorDiagnostics);
        throw new Error(message);
      }

      warnDiagnostics(locale, result.diagnostics);
    }

    callback(null, renderCatalogModule(result.messages), null);
  })().catch((error) => {
    callback(error);
  });
};
