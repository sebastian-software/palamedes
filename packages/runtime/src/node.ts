import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createI18n, type CreateI18nOptions, type PalamedesI18n } from "@palamedes/core";
import { registerRuntimeMacros } from "./node-macros";
import { createServerCatalogStore } from "./serverCatalog";

/** Where the generated runtime-macro files live when the code runs without a bundler. */
export type NodeI18nSetup = {
  /**
   * The directory holding `macros.json` from `pmds extract --runtime-manifest`
   * and `catalogs/<locale>.mjs` from `pmds catalog compile --target js`.
   * Bundled builds ignore it.
   */
  readonly generated: URL | string;
};

/** Options for one request-local i18n instance. */
export type NodeI18nOptions = CreateI18nOptions & {
  /** The active locale selected by the host's request policy. */
  readonly locale: string;
};

/** Returns isolated i18n state for one request or run, backed by shared catalogs. */
export type CreateNodeI18n = (options: NodeI18nOptions) => Promise<PalamedesI18n>;

function directoryUrl(location: URL | string): URL {
  const url = typeof location === "string" ? pathToFileURL(path.resolve(location)) : location;
  return url.href.endsWith("/") ? url : new URL(`${url.href}/`);
}

/**
 * One i18n setup for Node backends, bundled or not.
 *
 * Without a bundler (native type stripping, plain `tsc` output), this
 * registers the runtime macro manifest once and loads each locale from the
 * precompiled catalog modules in `setup.generated`. In a build with a
 * Palamedes plugin, the plugin resolves this subpath to the bundled catalog
 * store instead, so the macros are compiled and `setup.generated` is unused.
 * Call it once per process.
 */
export function defineNodeI18n(setup: NodeI18nSetup): CreateNodeI18n {
  const generated = directoryUrl(setup.generated);
  registerRuntimeMacros(new URL("macros.json", generated));
  const catalogs = new URL("catalogs/", generated);
  // The compiled locales are fixed at startup; anything else is rejected
  // before it reaches a dynamic import.
  const locales = new Set(
    readdirSync(catalogs)
      .filter((file) => file.endsWith(".mjs"))
      .map((file) => file.slice(0, -".mjs".length)),
  );
  const store = createServerCatalogStore({
    async load({ locale }) {
      if (!locales.has(locale)) throw new Error("Unsupported catalog locale");
      const module = await import(new URL(`${locale}.mjs`, catalogs).href);
      return [module.messages];
    },
  });

  return async (options) => {
    const messages = await store.load(options.locale);
    const i18n = createI18n(options);
    i18n.load(options.locale, messages);
    return i18n;
  };
}
