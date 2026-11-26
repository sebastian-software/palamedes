import { createHmac, timingSafeEqual } from "node:crypto";
import { type Dirent, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type { evalManifest as evalManifestType } from "next/dist/server/load-manifest.external.js";
import type { workAsyncStorage as workAsyncStorageType } from "next/dist/server/app-render/work-async-storage.external.js";
import type { workUnitAsyncStorage as workUnitAsyncStorageType } from "next/dist/server/app-render/work-unit-async-storage.external.js";

/** The request header an app's Proxy sets with the locale it resolved. */
export const CLIENT_CATALOG_LOCALE_HEADER = "x-palamedes-locale";

/**
 * Precedence between the `locale` root route param and the
 * `x-palamedes-locale` request header when selecting client chunk permutations:
 * - `"route-first"` (default): prefers `rootParams.locale` when present and
 *   only reads `x-palamedes-locale` when no `locale` root param exists.
 * - `"route"`: reads `rootParams.locale` only and ignores `x-palamedes-locale`.
 * - `"header"`: prefers `x-palamedes-locale` over `rootParams.locale` for
 *   applications whose Proxy always sets or strips that header on every route.
 */
export type ClientCatalogLocaleSource = "route-first" | "route" | "header";

const VALID_LOCALE_SOURCES: ReadonlySet<string> = new Set<ClientCatalogLocaleSource>([
  "route-first",
  "route",
  "header",
]);

function resolveLocaleSourceOption(options: ClientCatalogHeaderOptions): ClientCatalogLocaleSource {
  if (!("localeSource" in options)) return "route-first";
  if (typeof options.localeSource === "string" && VALID_LOCALE_SOURCES.has(options.localeSource)) {
    return options.localeSource as ClientCatalogLocaleSource;
  }
  throw new Error(
    `Palamedes client catalog permutations: unsupported localeSource ${JSON.stringify(options.localeSource)}. Expected "route-first", "route", or "header".`,
  );
}

export type ClientCatalogHeaderOptions = {
  /**
   * Precedence between `rootParams.locale` and `x-palamedes-locale`.
   * @default "route-first"
   */
  localeSource?: ClientCatalogLocaleSource;
  /**
   * Optional HMAC secret shared with `proxy.ts` via
   * `signClientCatalogLocaleHeader()`. When configured, `x-palamedes-locale`
   * is accepted only when its signature verifies; unsigned or forged headers
   * are ignored.
   */
  headerSecret?: string;
};

export type ResolveRenderLocaleOptions = ClientCatalogHeaderOptions & {
  /**
   * Whether the route's root layout sits at or below an optional catch-all
   * `[[...locale]]` segment. Derived from the Next.js client reference
   * manifest by `bindClientCatalogPermutationsAt()`.
   */
  optionalRootLocale?: boolean;
};

/**
 * Signs a locale value for the internal `x-palamedes-locale` Proxy header with
 * HMAC-SHA256 so forged incoming headers are ignored when
 * `bindClientCatalogPermutations({ headerSecret })` is configured.
 */
export function signClientCatalogLocaleHeader(locale: string, secret: string): string {
  if (!secret) {
    throw new Error("signClientCatalogLocaleHeader() requires a non-empty secret.");
  }
  const mac = createHmac("sha256", secret).update(locale).digest("base64url");
  return `${locale}.${mac}`;
}

/**
 * Verifies a signed `x-palamedes-locale` header value produced by
 * `signClientCatalogLocaleHeader()` using HMAC-SHA256 and returns the plain
 * locale string, or `undefined` when the header is missing, unsigned, or fails
 * verification.
 */
export function verifyClientCatalogLocaleHeader(
  headerValue: string | null | undefined,
  secret: string,
): string | undefined {
  if (!secret) {
    throw new Error("verifyClientCatalogLocaleHeader() requires a non-empty secret.");
  }
  if (!headerValue) return;
  const separator = headerValue.lastIndexOf(".");
  if (separator <= 0) return;
  const locale = headerValue.slice(0, separator);
  const providedMac = headerValue.slice(separator + 1);
  if (!locale || !providedMac) return;
  const expectedMac = createHmac("sha256", secret).update(locale).digest("base64url");
  const providedBytes = Buffer.from(providedMac, "utf8");
  const expectedBytes = Buffer.from(expectedMac, "utf8");
  if (providedBytes.length !== expectedBytes.length) return;
  return timingSafeEqual(providedBytes, expectedBytes) ? locale : undefined;
}

function parseLocaleHeader(
  raw: string | null,
  options: { requireSignature: boolean; secret?: string },
): string | undefined {
  if (!raw) return;
  if (!options.requireSignature) return raw;
  if (typeof options.secret !== "string" || options.secret.length === 0) return;
  return verifyClientCatalogLocaleHeader(raw, options.secret);
}

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

type LocaleResolver = (
  locales: readonly string[],
  fallback: string,
  optionalRootLocale?: boolean,
) => string;
type BindableManifest = {
  [BIND_GLOBAL]?: (resolve: LocaleResolver) => void;
};

type RenderStore = ReturnType<typeof workAsyncStorageType.getStore>;
type UnitStore = ReturnType<typeof workUnitAsyncStorageType.getStore>;

const localeByRender = new WeakMap<object, string>();
const ROOT_OPTIONAL_CATCH_ALL_LOCALE_ROUTE = /^\/(?:\([^/]+\)\/)*\[\[\.\.\.locale\]\](?:\/|$)/u;

function hasRootOptionalLocaleRoute(render: RenderStore): boolean {
  if (!render) return false;
  if (typeof render.route === "string" && ROOT_OPTIONAL_CATCH_ALL_LOCALE_ROUTE.test(render.route)) {
    return true;
  }
  return typeof render.page === "string" && ROOT_OPTIONAL_CATCH_ALL_LOCALE_ROUTE.test(render.page);
}

/*
 * By default (`localeSource: "route-first"`), a present root route param named
 * `locale` wins so an untrusted incoming `x-palamedes-locale` header cannot
 * override `app/[locale]/` routes or poison route-keyed ISR/CDN caches. When
 * no `locale` root param exists, the Proxy header decides (unless
 * `localeSource: "route"` disables headers). Apps that explicitly opt into
 * `localeSource: "header"` let the Proxy header take precedence, and any
 * header-reading mode can require an HMAC signature via `headerSecret`. Other
 * param names are never guessed at, and unknown or missing locales fall back
 * to the source locale so `notFound()`, `_not-found`, and `_global-error` work
 * without Proxy validation. The result is memoized per render because Next
 * serializes segment prefetch files and ISR output after the request store is
 * gone.
 */
export function resolveRenderLocale(
  locales: readonly string[],
  fallback: string,
  render: RenderStore,
  unit: UnitStore,
  options: ResolveRenderLocaleOptions = {},
): string {
  const memoized = render && localeByRender.get(render);
  if (memoized) return memoized;

  const localeSource = resolveLocaleSourceOption(options);
  const rootParams =
    unit && "rootParams" in unit && unit.rootParams && typeof unit.rootParams === "object"
      ? unit.rootParams
      : undefined;
  const hasRootLocaleParam = rootParams !== undefined && Object.hasOwn(rootParams, "locale");
  const hasOptionalRootLocale =
    options.optionalRootLocale !== undefined
      ? options.optionalRootLocale
      : hasRootOptionalLocaleRoute(render);
  const hasRootLocale = hasRootLocaleParam || hasOptionalRootLocale;
  const rootLocale = hasRootLocaleParam ? rootParams.locale : undefined;
  const readHeaderLocale = () =>
    unit && "headers" in unit && unit.headers
      ? parseLocaleHeader(unit.headers.get(CLIENT_CATALOG_LOCALE_HEADER), {
          requireSignature: "headerSecret" in options,
          secret: options.headerSecret,
        })
      : undefined;

  let candidate: unknown;
  if (localeSource === "header") {
    candidate = readHeaderLocale() ?? (hasRootLocale ? rootLocale : undefined);
  } else if (localeSource === "route") {
    candidate = hasRootLocale ? rootLocale : undefined;
  } else {
    candidate = hasRootLocale ? rootLocale : readHeaderLocale();
  }
  const locale =
    typeof candidate === "string" && locales.includes(candidate) ? candidate : fallback;
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
export function bindClientCatalogPermutationsAt(
  distDir: string,
  options: ClientCatalogHeaderOptions = {},
): string[] {
  const hasLocaleSource = "localeSource" in options;
  const validatedLocaleSource = resolveLocaleSourceOption(options);
  const hasHeaderSecret = "headerSecret" in options;
  if (
    hasHeaderSecret &&
    (typeof options.headerSecret !== "string" || options.headerSecret.length === 0)
  ) {
    throw new Error(
      "Palamedes client catalog permutations: headerSecret must be a non-empty string when provided.",
    );
  }
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
  const resolveOptions: ClientCatalogHeaderOptions = {
    ...(hasLocaleSource ? { localeSource: validatedLocaleSource } : {}),
    ...(hasHeaderSecret ? { headerSecret: options.headerSecret } : {}),
  };

  const resolve: LocaleResolver = (locales, fallback, optionalRootLocale) => {
    const { workAsyncStorage, workUnitAsyncStorage } = loadStorages();
    return resolveRenderLocale(
      locales,
      fallback,
      workAsyncStorage.getStore(),
      workUnitAsyncStorage.getStore(),
      typeof optionalRootLocale === "boolean"
        ? { ...resolveOptions, optionalRootLocale }
        : resolveOptions,
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

export type BindClientCatalogPermutationsOptions = ClientCatalogHeaderOptions & {
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
  const bound = bindClientCatalogPermutationsAt(absoluteDistDir, options);
  if (bound.length === 0) {
    throw new Error(
      `Palamedes client catalog permutations: ${absoluteDistDir}/server/app has no client reference manifests with permutation tables. Start the server from the project directory, or pass { dir } to bindClientCatalogPermutations().`,
    );
  }
  return bound;
}
