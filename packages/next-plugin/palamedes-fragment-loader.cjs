"use strict";

const path = require("node:path");
const { catalogResourcePath, loadPalamedesConfig } = require("@palamedes/config");
const { loadConfigCached } = require("./palamedes-config-cache.cjs");
const poLoader = require("./palamedes-po-loader.cjs");

/** Compile selected catalogs without passing full PO contents through the host loader pool. */
module.exports = function palamedesFragmentLoader() {
  const callback = this.async();
  const options = this.getOptions?.() ?? {};
  const cwd = options.cwd ?? this.rootContext;

  (async () => {
    const cfg = await loadConfigCached(options.configPath, loadPalamedesConfig, cwd);
    const parameters = new URLSearchParams(this.resourceQuery ?? "");
    const catalog = parameters.get("palamedes-catalog");
    const selection = parameters.get("palamedes-selected");
    if (!catalog || !selection) {
      throw new TypeError("Invalid Palamedes catalog fragment query.");
    }
    const resourcePath = path.resolve(cfg.rootDir, catalog);
    if (
      !cfg.catalogs.some((configured) =>
        cfg.locales.some(
          (locale) => path.resolve(catalogResourcePath(cfg, configured, locale)) === resourcePath,
        ),
      )
    ) {
      throw new TypeError("The Palamedes fragment query does not identify a configured catalog.");
    }

    // Reuse the canonical catalog pipeline, including fallback dependencies,
    // diagnostics, and compile-failure policy. The host watches the real PO
    // files through addDependency; their contents stay inside the compiler.
    const context = Object.create(this);
    Object.defineProperties(context, {
      resourcePath: { value: resourcePath },
      resourceQuery: { value: `?palamedes-selected=${selection}` },
      async: { value: () => callback },
    });
    poLoader.call(context);
  })().catch((error) => callback(error));
};
