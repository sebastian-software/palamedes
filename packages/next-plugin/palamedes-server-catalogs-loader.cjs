"use strict";

const path = require("node:path");

const {
  catalogResourcePath,
  getConfigDependencies,
  loadPalamedesConfigSync,
} = require("@palamedes/config");
const { loadConfigCachedSync } = require("./palamedes-config-cache.cjs");

/** Generate lazy full catalogs for the server; the application supplies only locale policy. */
module.exports = function palamedesServerCatalogsLoader() {
  this.cacheable?.();
  const options = this.getOptions?.() ?? {};
  const config = loadConfigCachedSync(options.configPath, loadPalamedesConfigSync, options.cwd);
  for (const dependency of getConfigDependencies(config)) this.addDependency?.(dependency);

  const loaders = config.locales.map((locale) => {
    const imports = config.catalogs.map((catalog) => {
      if ((catalog.format ?? "po") !== "po") {
        throw new Error(
          `The Next adapter supports PO catalogs; ${catalog.path} uses ${catalog.format}.`,
        );
      }
      const resourcePath = catalogResourcePath(config, catalog, locale);
      let specifier = path
        .relative(path.dirname(this.resourcePath), resourcePath)
        .split(path.sep)
        .join("/");
      if (!specifier.startsWith(".")) specifier = `./${specifier}`;
      return `import(${JSON.stringify(specifier)}).then(module => module.messages)`;
    });
    return `${JSON.stringify(locale)}: () => Promise.all([${imports.join(",")}])`;
  });

  // Re-evaluation after a watched config/catalog edit creates a new store.
  // Requests already holding an earlier immutable catalog keep their view.
  return `import { createServerCatalogStore } from "@palamedes/runtime/server";
const loaders = {${loaders.join(",")}};
const store = createServerCatalogStore({
  load: ({ locale }) => {
    if (!Object.hasOwn(loaders, locale)) throw new RangeError("Unsupported server catalog locale.");
    return loaders[locale]();
  }
});
export function loadServerCatalog(locale) { return store.load(locale); }
`;
};
