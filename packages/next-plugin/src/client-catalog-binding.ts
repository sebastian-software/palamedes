import { type Dirent, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { evalManifest as evalManifestType } from "next/dist/server/load-manifest.external.js";
import type { workAsyncStorage as workAsyncStorageType } from "next/dist/server/app-render/work-async-storage.external.js";
import type { workUnitAsyncStorage as workUnitAsyncStorageType } from "next/dist/server/app-render/work-unit-async-storage.external.js";

import { CLIENT_CATALOG_LOCALE_HEADER } from "./client-catalog-locale-header";

/*
 * Binds the locale resolver into the client reference manifests of a
 * permutation build (ADR-031). Next evaluates each manifest once per process
 * in a VM context, cached by absolute path in
 * next/dist/server/load-manifest.external.js, and freezes the result. The
 * adapter the build appended keeps a bind function on that context, which
 * survives the freeze; evaluating the same path here returns the same context,
 * before or after Next did.
 */

/** Inlined by withPalamedes(): the config's distDir, relative to the project. */
export const CLIENT_CATALOG_PERMUTATIONS_ENV = "PALAMEDES_NEXT_CATALOG_PERMUTATIONS";
/** Set by withPalamedes() for the build's Node preload: the absolute distDir. */
export const CLIENT_CATALOG_PERMUTATIONS_DIST_ENV = "__PALAMEDES_NEXT_CATALOG_PERMUTATIONS_DIST";
const BIND_GLOBAL = "__PALAMEDES_CLIENT_CATALOG_BIND";

type LocaleResolver = (locales: readonly string[]) => string;
type BindableManifest = { [BIND_GLOBAL]?: (resolve: LocaleResolver) => void };

type RenderStore = ReturnType<typeof workAsyncStorageType.getStore>;
type UnitStore = ReturnType<typeof workUnitAsyncStorageType.getStore>;

const localeByRender = new WeakMap<object, string>();

/*
 * The root param wins: Next matched it, so a client cannot change it. The
 * header is for trees without a locale segment; the app's Proxy sets it with
 * setRequestLocale() and overwrites incoming values. The result is memoized
 * per render because Next serializes segment prefetch files and ISR output
 * after the request store is gone.
 */
export function resolveRenderLocale(
  locales: readonly string[],
  render: RenderStore,
  unit: UnitStore,
): string {
  const memoized = render && localeByRender.get(render);
  if (memoized) return memoized;

  let locale: string | undefined;
  if (unit && "rootParams" in unit && unit.rootParams) {
    locale = Object.values(unit.rootParams).find(
      (value): value is string => typeof value === "string" && locales.includes(value),
    );
  }
  if (!locale && unit && "headers" in unit && unit.headers) {
    locale = unit.headers.get(CLIENT_CATALOG_LOCALE_HEADER) ?? undefined;
  }
  if (!locale) {
    throw new Error(
      `Palamedes client catalog permutations: no locale for this render${render ? ` of ${render.route}` : ""}. Put the locale in a root route param, or resolve it in proxy.ts and pass it with setRequestLocale() from @palamedes/next-plugin/proxy.`,
    );
  }
  if (!locales.includes(locale)) {
    throw new Error(
      `Palamedes client catalog permutations: locale "${locale}" has no chunk permutation; the build compiled ${locales.join(", ")}.`,
    );
  }
  if (render) localeByRender.set(render, locale);
  return locale;
}

function manifestFiles(directory: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith("_client-reference-manifest.js"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

/**
 * Binds every client reference manifest under `<distDir>/server/app`. Returns
 * the bound manifests; an empty list means the directory has none, which is
 * the case in processes that never render.
 */
export function bindClientCatalogPermutationsAt(distDir: string): string[] {
  // Resolve Next from the build output, so a monorepo with several Next
  // copies binds the instance that serves this app.
  const nextRequire = createRequire(path.join(distDir, "package.json"));
  const { evalManifest } = nextRequire("next/dist/server/load-manifest.external.js") as {
    evalManifest: typeof evalManifestType;
  };
  // Loaded on first use: the storage modules create Next's shared
  // AsyncLocalStorage singletons when they load, and a Node preload runs
  // before Next installs the global AsyncLocalStorage they need.
  type Storages = {
    workAsyncStorage: typeof workAsyncStorageType;
    workUnitAsyncStorage: typeof workUnitAsyncStorageType;
  };
  let storages: Storages | undefined;
  function loadStorages(): Storages {
    if (storages) return storages;
    const loaded: Storages = {
      ...nextRequire("next/dist/server/app-render/work-async-storage.external.js"),
      ...nextRequire("next/dist/server/app-render/work-unit-async-storage.external.js"),
    };
    storages = loaded;
    return loaded;
  }
  const resolve: LocaleResolver = (locales) => {
    const { workAsyncStorage, workUnitAsyncStorage } = loadStorages();
    return resolveRenderLocale(
      locales,
      workAsyncStorage.getStore(),
      workUnitAsyncStorage.getStore(),
    );
  };

  const bound: string[] = [];
  for (const file of manifestFiles(path.join(distDir, "server", "app"))) {
    const context = evalManifest(file) as BindableManifest;
    const bind = context[BIND_GLOBAL];
    if (typeof bind !== "function") continue;
    bind(resolve);
    bound.push(file);
  }
  return bound;
}

export type BindClientCatalogPermutationsOptions = {
  /** The Next project directory that holds `distDir`. Defaults to `process.cwd()`. */
  dir?: string;
};

/**
 * Experimental: binds the locale resolver of `experimentalClientCatalogPermutations`
 * in a server process. Call it from `register()` in `instrumentation.ts` under
 * the Node runtime; it returns `undefined` for builds without the option, so
 * the call needs no condition.
 */
export function bindClientCatalogPermutations(
  options: BindClientCatalogPermutationsOptions = {},
): string[] | undefined {
  const distDir = process.env[CLIENT_CATALOG_PERMUTATIONS_ENV];
  if (!distDir) return;
  const absoluteDistDir = path.join(options.dir ?? process.cwd(), distDir);
  const bound = bindClientCatalogPermutationsAt(absoluteDistDir);
  if (bound.length === 0) {
    throw new Error(
      `Palamedes client catalog permutations: ${absoluteDistDir}/server/app has no client reference manifests with permutation tables. Start the server from the project directory, or pass { dir } to bindClientCatalogPermutations().`,
    );
  }
  return bound;
}
