import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  catalogResourcePath,
  getConfigDependencies,
  loadPalamedesConfigSync,
} from "@palamedes/config";
import { compileCatalogModule } from "@palamedes/core-node";
import { transformPalamedesMacros } from "@palamedes/transform";

export const runtimeId = "#palamedes/node";

// This is a private integration probe, not a new public adapter API.
export function createIntegration(root) {
  const config = loadPalamedesConfigSync({ cwd: root });
  const compilerConfig = {
    rootDir: config.rootDir,
    locales: config.locales,
    sourceLocale: config.sourceLocale,
    fallbackLocales: config.fallbackLocales,
    pseudoLocale: config.pseudoLocale,
    catalogs: config.catalogs,
  };
  const catalogs = config.locales.flatMap((locale) =>
    config.catalogs.map((catalog, index) => ({
      locale,
      fileName: `${locale}-${index}.mjs`,
      resource: catalogResourcePath(config, catalog, locale),
    })),
  );

  function compile(catalog) {
    const result = compileCatalogModule(compilerConfig, catalog.resource, {
      locale: catalog.locale,
      pseudoLocale: config.pseudoLocale,
    });
    for (const warning of result.warnings) console.warn(warning);
    return result;
  }

  function runtimeSource(specifier) {
    const loaders = config.locales.map((locale) => {
      const imports = catalogs
        .filter((c) => c.locale === locale)
        .map((c) => `import(${JSON.stringify(specifier(c))}).then(m=>m.messages)`);
      return `${JSON.stringify(locale)}:()=>Promise.all([${imports.join(",")}])`;
    });
    return [
      'import {createI18n} from "@palamedes/core/compiled";',
      'import {createServerCatalogStore} from "@palamedes/runtime/server";',
      `const loaders={${loaders.join(",")}};`,
      'const store=createServerCatalogStore({load:({locale})=>{if(!Object.hasOwn(loaders,locale))throw new Error("Unsupported catalog locale: "+locale);return loaders[locale]()}});',
      "export async function createNodeI18n(options){const messages=await store.load(options.locale);const i18n=createI18n(options);i18n.load(options.locale,messages);return i18n;}",
    ].join("\n");
  }

  return {
    catalogs,
    configFiles: getConfigDependencies(config),
    compile,
    runtimeSource,
    transform(file) {
      return transformPalamedesMacros(readFileSync(file, "utf8"), file);
    },
    createHooks() {
      return {
        resolve(specifier, context, nextResolve) {
          if (specifier === runtimeId) {
            // Anchor the generated module in the application for package resolution.
            return {
              url: pathToFileURL(path.join(root, ".palamedes/server.mjs")).href,
              shortCircuit: true,
            };
          }
          return nextResolve(specifier, context);
        },
        load(url, context, nextLoad) {
          if (url === pathToFileURL(path.join(root, ".palamedes/server.mjs")).href) {
            return {
              format: "module",
              source: runtimeSource((c) => pathToFileURL(c.resource).href),
              shortCircuit: true,
            };
          }
          const catalog = catalogs.find((c) => pathToFileURL(c.resource).href === url);
          if (catalog)
            return { format: "module", source: compile(catalog).code, shortCircuit: true };
          const loaded = nextLoad(url, context);
          if (
            url.startsWith(pathToFileURL(path.join(root, "src") + path.sep).href) &&
            /\.[cm]?[jt]s$/u.test(new URL(url).pathname)
          ) {
            const result = transformPalamedesMacros(String(loaded.source), fileURLToPath(url));
            if (result.hasChanged) return { ...loaded, source: result.code };
          }
          return loaded;
        },
      };
    },
  };
}
