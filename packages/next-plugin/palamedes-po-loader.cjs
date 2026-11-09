"use strict";

const path = require("node:path");
const { readFile } = require("node:fs/promises");
const { catalogResourcePath, loadPalamedesConfig } = require("@palamedes/config");
const {
  compileCatalogArtifactSelectedAsync,
  compileCatalogModuleAsync,
} = require("@palamedes/core-node");
const {
  createCatalogLoaderResult,
  createMissingErrorMessage,
  transformPalamedesMacros,
} = require("@palamedes/transform");
const { loadConfigCached } = require("./palamedes-config-cache.cjs");
const { warnMissingAddDependency } = require("./palamedes-dev-warning.cjs");

const SELECTED_MESSAGES_QUERY = "palamedes-selected";

function resolveLoaderCwd(context, options) {
  if (typeof options.cwd === "string" && options.cwd.length > 0) {
    return path.resolve(options.cwd);
  }
  if (typeof context.rootContext === "string" && context.rootContext.length > 0) {
    return path.resolve(context.rootContext);
  }
}

module.exports = function palamedesPoLoader() {
  const callback = this.async();
  const options = typeof this.getOptions === "function" ? this.getOptions() : {};
  const failOnMissing = options.failOnMissing === true;

  (async () => {
    const cfg = await loadConfigCached(
      options.configPath,
      loadPalamedesConfig,
      resolveLoaderCwd(this, options),
    );
    const parameters = new URLSearchParams(this.resourceQuery ?? "");
    const catalog = parameters.get("palamedes-catalog");
    const selection = parameters.get(SELECTED_MESSAGES_QUERY);
    const sourceModule = parameters.get("palamedes-source");
    if (sourceModule === "") {
      throw new TypeError("Invalid Palamedes catalog fragment source.");
    }
    const sourcePath = sourceModule === null ? null : path.resolve(cfg.rootDir, sourceModule);
    const resourcePath = catalog === null ? this.resourcePath : path.resolve(cfg.rootDir, catalog);
    const resource = path.resolve(resourcePath);
    const configuredLocale = cfg.locales.find((candidate) =>
      cfg.catalogs.some(
        (catalog) => path.resolve(catalogResourcePath(cfg, catalog, candidate)) === resource,
      ),
    );
    if (catalog !== null && (!catalog || !selection || !configuredLocale)) {
      throw new TypeError("Invalid Palamedes catalog fragment query.");
    }
    const locale = configuredLocale ?? path.basename(resourcePath, path.extname(resourcePath));
    const artifactConfig = {
      rootDir: cfg.rootDir,
      locales: cfg.locales,
      sourceLocale: cfg.sourceLocale,
      fallbackLocales: cfg.fallbackLocales,
      pseudoLocale: cfg.pseudoLocale,
      catalogs: cfg.catalogs,
    };
    const loaderOptions = {
      locale,
      pseudoLocale: cfg.pseudoLocale,
      failOnMissing,
      missingFailureHint:
        "You see this error because `failOnMissing=true` in Palamedes Next plugin configuration.",
    };
    let result;
    if (selection) {
      const compiledIds = JSON.parse(Buffer.from(selection, "base64url").toString("utf8"));
      if (!Array.isArray(compiledIds) || !compiledIds.every((id) => typeof id === "string")) {
        throw new TypeError("Invalid Palamedes selected-message query.");
      }
      let artifact;
      let staleWarning;
      try {
        artifact = await compileCatalogArtifactSelectedAsync(
          artifactConfig,
          resourcePath,
          compiledIds,
        );
      } catch (error) {
        if (sourcePath === null) throw error;

        // Turbopack can replay an old fragment task after its importing module
        // changed or disappeared. Recheck only a failed task's authored source;
        // unknown IDs still selected by current source remain a hard error.
        let source;
        try {
          source = await readFile(sourcePath, "utf8");
        } catch (readError) {
          if (readError.code !== "ENOENT") throw readError;
          source = "";
        }
        const currentIds = new Set(transformPalamedesMacros(source, sourcePath).compiledIds ?? []);
        const activeIds = compiledIds.filter((id) => currentIds.has(id));
        if (activeIds.length === compiledIds.length) throw error;

        // Retry through the same compiler even for an empty selection, so an
        // invalid current catalog or configuration cannot become a success.
        artifact = await compileCatalogArtifactSelectedAsync(
          artifactConfig,
          resourcePath,
          activeIds,
        );
        staleWarning = `Ignored an outdated Palamedes catalog fragment for ${sourceModule}: its source no longer selects ${compiledIds.length - activeIds.length} message(s).`;
      }
      result = {
        ...createCatalogLoaderResult(artifact, loaderOptions),
        watchFiles: artifact.watchFiles,
      };
      if (staleWarning) result.warnings.push(staleWarning);
      const resolvedLocale = artifact.resolvedLocaleChain?.[0] ?? locale;
      if (!failOnMissing && resolvedLocale !== cfg.pseudoLocale && artifact.missing.length > 0) {
        result.warnings.push(createMissingErrorMessage(resolvedLocale, artifact.missing));
      }
    } else {
      result = await compileCatalogModuleAsync(artifactConfig, resourcePath, loaderOptions);
    }
    if (typeof this.addDependency === "function") {
      const configDependencies = Array.isArray(cfg.configDependencies)
        ? cfg.configDependencies
        : [cfg.configPath];
      configDependencies.filter(Boolean).forEach((file) => this.addDependency(file));
      result.watchFiles.forEach((file) => {
        this.addDependency(file);
      });
      if (sourcePath !== null) this.addDependency(sourcePath);
    } else if (selection) {
      // Selected artifacts fold fallback catalogs into a split sidecar. Without
      // addDependency a host cannot invalidate those indirect inputs.
      warnMissingAddDependency(this);
    }

    result.warnings.forEach((warning) => {
      // emitWarning reaches the Next overlay and webpack's deduplicated
      // diagnostics; console.warn repeated on every rebuild instead.
      if (typeof this.emitWarning === "function") {
        this.emitWarning(new Error(warning));
      } else {
        console.warn(warning);
      }
    });

    callback(null, result.code, null);
  })().catch((error) => {
    callback(error);
  });
};
