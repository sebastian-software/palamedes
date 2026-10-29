import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import type { AssetServer } from "remix/assets";

import {
  createI18n,
  type CompiledCatalogMessages,
  type CreateI18nOptions,
  type PalamedesI18n,
} from "@palamedes/core";
import type { LocaleControls, LocaleSource } from "@palamedes/core/locale";
import { compileCatalogModule, type CatalogArtifactConfig } from "@palamedes/core-node";
import type { I18nInstance } from "@palamedes/runtime";
import {
  createScopedI18nRunner,
  createServerCatalogStore,
  createServerI18nScope,
} from "@palamedes/runtime/server";
import { AcceptLanguage } from "remix/headers";
import { createContextKey, type Middleware } from "remix/router";

import type { PalamedesRemixCatalogAssetRegistry } from "./index";

export type RemixI18nResolver<T extends I18nInstance = I18nInstance> = (
  request: Request,
) => T | Promise<T>;

export type RemixI18nRequestScope<T extends I18nInstance = I18nInstance> = {
  run<Result>(request: Request, callback: (i18n: T) => Result | Promise<Result>): Promise<Result>;
  activate(i18n: T): T;
  get(): T | undefined;
};

export type RemixI18nRequestScopeOptions = {
  /** Message of the error thrown when `resolveI18n` fails; the original error is its `cause`. */
  readonly failureMessage?: string;
};

export type RemixLocaleStrategy = "cookie" | "route" | "subdomain" | "tld";

export type RemixLocaleResolutionInput = {
  headers?: Headers;
  params?: Record<string, string | undefined>;
  request: Request;
};

/**
 * What `run()` and `resolveLocale()` accept: a Fetch request, or a Remix
 * `RequestContext` (or any `{ request, headers?, params? }` object), whose
 * route params and mutable headers then take part in locale resolution.
 */
export type RemixI18nRunInput = Request | RemixLocaleResolutionInput;

export type RemixResolvedLocale<TLocale extends string> = {
  locale: TLocale;
  source: LocaleSource;
};

export type RemixI18nContextValue<
  TLocale extends string = string,
  T extends I18nInstance = I18nInstance,
> = {
  i18n: T;
  locale: TLocale;
  source: LocaleSource;
};

/** Request-local `createI18n` options other than the locale, such as `timeZone`. */
export type RemixI18nOptions = Omit<CreateI18nOptions, "locale">;

/** Returns the `createI18n` options for one request and its resolved locale. */
export type RemixI18nOptionsResolver<TLocale extends string = string> = (
  request: Request,
  locale: TLocale,
) => RemixI18nOptions | Promise<RemixI18nOptions>;

/**
 * Catalog configuration for `catalogAssets.config`: the resolved shape of a
 * Palamedes config that the adapter compiles browser catalog assets from.
 * Paths resolve from `rootDir`; `format` defaults to `"po"`.
 */
export type RemixCatalogAssetConfig = {
  rootDir: string;
  locales: string[];
  sourceLocale: string;
  fallbackLocales?: string[] | Record<string, string[]>;
  pseudoLocale?: string;
  /** Catalog `include`/`exclude` select source files for extraction; asset compilation ignores them. */
  catalogs: Array<{ path: string; format?: "po" | "fcl"; include?: string[]; exclude?: string[] }>;
};

export type RemixCatalogAssetOptions<TLocale extends string = string> = {
  config?: RemixCatalogAssetConfig;
  resolvePath?: (locale: TLocale) => string;
  basePath?: string;
  registry?: PalamedesRemixCatalogAssetRegistry;
};

export type RemixI18nServerOptions<TLocale extends string> = {
  locales: LocaleControls<TLocale>;
  strategy: RemixLocaleStrategy;
  /** Synchronous or asynchronous executable catalog loader. Omit when using a registry. */
  loadMessages?: (locale: TLocale) => CompiledCatalogMessages | Promise<CompiledCatalogMessages>;
  /**
   * Deployment version for client catalog assets. Defaults to a deterministic
   * digest of the executable catalog asset each locale serves.
   */
  catalogVersion?: string;
  /**
   * Configuration for adapter-owned executable browser catalog assets. The
   * adapter compiles the requested locale into an ESM module and serves it
   * through `serveClientCatalogAsset()`; no catalog functions cross JSON.
   */
  catalogAssets?: RemixCatalogAssetOptions<TLocale>;
  /**
   * Formatting options for each request's i18n instance, such as `timeZone`,
   * or a function that returns them for the request and its resolved locale.
   */
  i18nOptions?: RemixI18nOptions | RemixI18nOptionsResolver<TLocale>;
  /**
   * Message of the error `run()` and `middleware()` throw when the locale,
   * `i18nOptions`, or catalog cannot be resolved; the original error is its `cause`.
   */
  failureMessage?: string;
  routeParam?: string;
  cookieName?: string;
  cookieMaxAge?: number;
};

/** The key `middleware()` stores the request's {@link RemixI18nContextValue} under. */
export type RemixI18nContextKey = {
  readonly defaultValue?: RemixI18nContextValue<string, I18nInstance>;
};

/**
 * A Remix `RequestContext`, or any object that reads context entries the same
 * way. `get()` reads the value `middleware()` stored for {@link remixI18nContext}.
 */
export type RemixI18nContextReader = {
  get(key: RemixI18nContextKey): unknown;
};

export type RemixI18nServer<TLocale extends string> = {
  resolveLocale(input: RemixI18nRunInput): RemixResolvedLocale<TLocale>;
  run<Result>(
    input: RemixI18nRunInput,
    callback: (context: RemixI18nContextValue<TLocale, PalamedesI18n>) => Result | Promise<Result>,
  ): Promise<Result>;
  middleware(): Middleware<{
    key: typeof remixI18nContext;
    value: RemixI18nContextValue<TLocale, PalamedesI18n>;
    property: "palamedes";
  }>;
  get(context?: RemixI18nContextReader): RemixI18nContextValue<TLocale, PalamedesI18n> | undefined;
  createClientCatalogAsset(locale: TLocale): RemixClientCatalogAsset<TLocale>;
  /**
   * Render the catalog preload link. The bootstrap loads the catalog from
   * `catalogAssets.basePath` through its import-map data, never from this link,
   * so a `basePath` override changes only the preload URL.
   */
  renderClientCatalog(locale: TLocale, options?: { basePath?: string }): string;
  /** Render the stable Remix import map and external adapter bootstrap for an entry file. */
  renderClientEntry(entryPath: string, options: RemixClientEntryOptions): Promise<string>;
  serveClientCatalogAsset(request: Request): Response | undefined;
  serializeLocaleCookie(locale: TLocale): string;
};

export type RemixClientEntryOptions = {
  /** The same asset server that uses the Palamedes catalog loader. */
  assetServer: Pick<AssetServer, "getHref" | "getImportMap">;
  errorHtml?: string;
  /** CSP nonce applied to both the import map and the external module script. */
  nonce?: string;
};

export type RemixClientCatalogAsset<TLocale extends string = string> = {
  locale: TLocale;
  catalogVersion: string;
  source: string;
};

type CachedRemixClientCatalogAsset<TLocale extends string> = RemixClientCatalogAsset<TLocale> & {
  registryGeneration?: string;
};

export const remixI18nContext: RemixI18nContextKey =
  createContextKey<RemixI18nContextValue<string, I18nInstance>>();

// Each entry URL serves the same module on every worker. The URL digest keeps
// distinct application entries separate in the browser module cache. The
// request-specific entry URL, catalog mount and error markup reach the module
// only through the nonce-protected import map, scoped to this exact module URL.
// Document elements are never trusted for URLs or markup, so injected scripts
// or catalog links cannot redirect an import or replace the error UI. The
// catalog URL combines the server-written mount with the document locale, the
// same way lazy catalog fragments resolve theirs.
const CLIENT_ENTRY_DATA_SPECIFIER = "@palamedes/remix/entry-data";
const CLIENT_ENTRY_DATA_PREFIX = "data:application/json,";
const CLIENT_ENTRY_SOURCE = `import { startRemixClient } from "@palamedes/remix/client";
let data;
try {
  const resolved = import.meta.resolve(${JSON.stringify(CLIENT_ENTRY_DATA_SPECIFIER)});
  if (resolved.startsWith(${JSON.stringify(CLIENT_ENTRY_DATA_PREFIX)})) {
    const parsed = JSON.parse(decodeURIComponent(resolved.slice(${CLIENT_ENTRY_DATA_PREFIX.length})));
    if (typeof parsed?.entry === "string" && typeof parsed.catalog === "string") data = parsed;
  }
} catch {}
const locale = document.documentElement.lang;
// Missing entry data still reaches the default error UI instead of a blank page.
await startRemixClient(
  () =>
    data === undefined
      ? Promise.reject(new Error("Palamedes Remix application entry data is missing from the import map."))
      : import(data.entry),
  {
    catalogUrl:
      data === undefined || !locale
        ? undefined
        : new URL(data.catalog + encodeURIComponent(locale) + ".js", document.baseURI).href,
    errorHtml: typeof data?.errorHtml === "string" ? data.errorHtml : undefined,
  },
);
`;

const DEFAULT_FAILURE_MESSAGE =
  "Palamedes Remix i18n initialization failed before the handler ran.";

export function createRemixI18nRequestScope<T extends I18nInstance = I18nInstance>(
  resolveI18n: RemixI18nResolver<T>,
  options: RemixI18nRequestScopeOptions = {},
): RemixI18nRequestScope<T> {
  const runner = createScopedI18nRunner(resolveI18n, {
    failureMessage: options.failureMessage ?? DEFAULT_FAILURE_MESSAGE,
  });

  return {
    async run(request, callback) {
      return await runner.run(request, async (i18n) =>
        bindScopedResult(await callback(i18n), i18n, runner.scope),
      );
    },

    activate(i18n) {
      return runner.scope.activate(i18n);
    },

    get() {
      return runner.scope.get();
    },
  };
}

export function createRemixI18nServer<TLocale extends string>(
  options: RemixI18nServerOptions<TLocale>,
): RemixI18nServer<TLocale> {
  if (options.catalogAssets && Object.hasOwn(options.catalogAssets, "clientModuleUrl")) {
    throw new TypeError(
      "Remove catalogAssets.clientModuleUrl. Pass the actual assetServer to renderClientEntry(); stable Remix resolves bootstrap URLs and import-map scopes through that server's mounts.",
    );
  }
  assertNoRemovedRemixServerOptions(options);
  const failureMessage = options.failureMessage ?? DEFAULT_FAILURE_MESSAGE;
  const scope = createServerI18nScope<PalamedesI18n>();
  const catalogCache = new Map<TLocale, CompiledCatalogMessages>();
  const clientCatalogAssetCache = new Map<TLocale, CachedRemixClientCatalogAsset<TLocale>>();
  const scopedContexts = new WeakMap<
    PalamedesI18n,
    RemixI18nContextValue<TLocale, PalamedesI18n>
  >();
  const cookieName = options.cookieName ?? "locale";
  const cookieMaxAge = options.cookieMaxAge ?? 60 * 60 * 24 * 365;
  let serverRegistryGeneration = options.catalogAssets?.registry?.generation?.();

  if (!options.loadMessages && !options.catalogAssets?.registry?.load) {
    throw new Error(
      "Palamedes Remix requires loadMessages or catalogAssets.registry for server catalog loading.",
    );
  }

  const registryLoad = options.catalogAssets?.registry?.load;
  const serverCatalogStore = createServerCatalogStore<TLocale>({
    async load({ locale }) {
      if (options.loadMessages) {
        return [await options.loadMessages(locale)];
      }
      if (registryLoad) {
        return [await registryLoad(locale)];
      }
      throw new Error(
        "Palamedes Remix requires loadMessages or catalogAssets.registry for server catalog loading.",
      );
    },
  });

  const refreshRegistryGeneration = (): void => {
    const next = options.catalogAssets?.registry?.generation?.();
    if (next === undefined || next === serverRegistryGeneration) {
      serverRegistryGeneration = next;
      return;
    }
    serverRegistryGeneration = next;
    catalogCache.clear();
    serverCatalogStore.invalidate();
    clientCatalogAssetCache.clear();
  };

  const getMessages = async (locale: TLocale): Promise<CompiledCatalogMessages> => {
    refreshRegistryGeneration();
    const cached = catalogCache.get(locale);
    if (cached) {
      return cached;
    }
    const ready = serverCatalogStore.getReady(locale);
    if (ready) {
      catalogCache.set(locale, ready);
      return ready;
    }
    const messages = await serverCatalogStore.load(locale);
    catalogCache.set(locale, messages);
    return messages;
  };

  const createScopedContext = async (
    input: RemixI18nRunInput,
  ): Promise<RemixI18nContextValue<TLocale, PalamedesI18n>> => {
    try {
      const resolved = resolveLocaleFromInput(input, options);
      const i18nOptions =
        typeof options.i18nOptions === "function"
          ? await options.i18nOptions(normalizeInput(input).request, resolved.locale)
          : options.i18nOptions;
      const messages = await getMessages(resolved.locale);
      const i18n = createI18n({ ...i18nOptions, locale: resolved.locale });
      i18n.load(resolved.locale, messages);
      i18n.activate(resolved.locale);

      const context = {
        i18n,
        locale: resolved.locale,
        source: resolved.source,
      };
      scopedContexts.set(i18n, context);
      return context;
    } catch (error) {
      throw new Error(failureMessage, { cause: error });
    }
  };

  const createClientCatalogAsset = (locale: TLocale): RemixClientCatalogAsset<TLocale> => {
    refreshRegistryGeneration();
    const registryGeneration = options.catalogAssets?.registry?.generation?.();
    const cached = clientCatalogAssetCache.get(locale);
    if (cached && cached.registryGeneration === registryGeneration) {
      return cached;
    }

    const assetOptions = options.catalogAssets;
    if (!assetOptions) {
      throw new Error(
        "Palamedes Remix executable catalog assets require catalogAssets.config and catalogAssets.resolvePath.",
      );
    }

    if (!assetOptions.registry && (!assetOptions.config || !assetOptions.resolvePath)) {
      throw new Error(
        "Palamedes Remix executable catalog assets require catalogAssets.config and catalogAssets.resolvePath, or a shared catalogAssets.registry.",
      );
    }
    const resourcePath = assetOptions.resolvePath?.(locale);
    const result = assetOptions.registry
      ? undefined
      : compileCatalogModule(toCatalogArtifactConfig(assetOptions.config!), resourcePath!, {
          locale,
          pseudoLocale: assetOptions.config!.pseudoLocale,
          missingFailureHint:
            "You see this error because executable Remix catalog asset compilation failed on a missing translation.",
          compileFailureHint:
            "These errors fail loading because executable Remix catalog asset compilation was configured as fatal.",
          diagnosticsWarningHint:
            "Inspect the generated Remix catalog asset diagnostics before deploying this locale.",
        });
    result?.warnings.forEach((warning) => console.warn(warning));
    const catalogVersion = resolveCatalogAssetVersion(
      locale,
      result?.code ?? `fragment-registry:${registryGeneration ?? ""}`,
      options.catalogVersion,
    );
    const source = assetOptions.registry
      ? `export const messages={};export default { messages };export const fragmentRegistry=true;export const locale=${JSON.stringify(locale)};export const catalogVersion=${JSON.stringify(catalogVersion)};`
      : `${result?.code ?? ""}export const locale=${JSON.stringify(locale)};export const catalogVersion=${JSON.stringify(catalogVersion)};`;
    const asset = Object.freeze({ locale, catalogVersion, source, registryGeneration });
    clientCatalogAssetCache.set(locale, asset);
    return asset;
  };

  const renderClientCatalog = (locale: TLocale, renderOptions: { basePath?: string } = {}) => {
    const basePath = renderOptions.basePath ?? options.catalogAssets?.basePath ?? "/assets";
    const href = `${catalogAssetPrefix(basePath)}${encodeURIComponent(locale)}.js`;
    return `<link rel="modulepreload" href="${escapeHtmlAttribute(href)}" data-palamedes-catalog-locale="${escapeHtmlAttribute(locale)}" data-palamedes-catalog-version="${escapeHtmlAttribute(createClientCatalogAsset(locale).catalogVersion)}" />`;
  };

  const renderClientEntry = async (
    entryPath: string,
    entryOptions: RemixClientEntryOptions,
  ): Promise<string> => {
    const basePath = options.catalogAssets?.basePath ?? "/assets";
    // Node's require resolver selects our CJS export, but browser assets must use
    // the ESM sibling emitted by the same package build (including from CJS hosts).
    const clientPath = createRequire(import.meta.url)
      .resolve("@palamedes/remix/client")
      .replace(/\.cjs$/u, ".mjs");
    const [entryUrl, clientUrl, importMap] = await Promise.all([
      entryOptions.assetServer.getHref(entryPath),
      entryOptions.assetServer.getHref(clientPath),
      entryOptions.assetServer.getImportMap([entryPath, clientPath]),
    ]);
    const key = createHash("sha256")
      .update(JSON.stringify([CLIENT_ENTRY_SOURCE, clientUrl, entryUrl, entryOptions.errorHtml]))
      .digest("hex");
    const src = `${basePath.replace(/\/$/u, "")}/__palamedes/entry/${key}.js`;
    const nonce = entryOptions.nonce ? ` nonce="${escapeHtmlAttribute(entryOptions.nonce)}"` : "";
    const serializedImportMap = JSON.stringify({
      ...importMap,
      scopes: {
        ...importMap.scopes,
        [src]: {
          "@palamedes/remix/client": clientUrl,
          [CLIENT_ENTRY_DATA_SPECIFIER]: `${CLIENT_ENTRY_DATA_PREFIX}${encodeURIComponent(
            JSON.stringify({
              entry: entryUrl,
              catalog: catalogAssetPrefix(basePath),
              errorHtml: entryOptions.errorHtml ?? null,
            }),
          )}`,
        },
      },
    }).replace(/</gu, "\\u003c");
    return `<script type="importmap"${nonce}>${serializedImportMap}</script><script type="module" src="${escapeHtmlAttribute(src)}"${nonce}></script>`;
  };

  const serveClientCatalogAsset = (request: Request): Response | undefined => {
    const basePath = options.catalogAssets?.basePath ?? "/assets";
    const pathname = new URL(request.url).pathname;
    const entryPrefix = `${basePath.replace(/\/$/u, "")}/__palamedes/entry/`;
    if (pathname.startsWith(entryPrefix) && pathname.endsWith(".js")) {
      const key = pathname.slice(entryPrefix.length, -3);
      return !/^[a-f0-9]{64}$/u.test(key)
        ? new Response("Unknown application entry.", { status: 404 })
        : new Response(CLIENT_ENTRY_SOURCE, {
            headers: {
              "content-type": "application/javascript; charset=utf-8",
              "cache-control": "no-cache",
            },
          });
    }
    const prefix = catalogAssetPrefix(basePath);
    if (!pathname.startsWith(prefix) || !pathname.endsWith(".js")) {
      return undefined;
    }
    const encodedLocale = pathname.slice(prefix.length, -3);
    const locale = decodeURIComponent(encodedLocale) as TLocale;
    if (!options.locales.locales.includes(locale)) {
      return new Response(`Unknown Palamedes locale "${locale}".`, { status: 404 });
    }
    try {
      const asset = createClientCatalogAsset(locale);
      const etag = `"${asset.catalogVersion}"`;
      if (request.headers.get("if-none-match") === etag) {
        return new Response(null, {
          status: 304,
          headers: { etag, "cache-control": "no-cache" },
        });
      }
      return new Response(asset.source, {
        headers: {
          "cache-control": "no-cache",
          "content-type": "application/javascript; charset=utf-8",
          etag,
          vary: "Accept-Encoding",
        },
      });
    } catch (error) {
      return new Response(
        `Palamedes Remix executable catalog asset failed for locale "${locale}": ${error instanceof Error ? error.message : String(error)}`,
        { status: 500 },
      );
    }
  };

  async function run<Result>(
    input: RemixI18nRunInput,
    callback: (context: RemixI18nContextValue<TLocale, PalamedesI18n>) => Result | Promise<Result>,
  ): Promise<Result> {
    const context = await createScopedContext(input);
    return await scope.run(context.i18n, async () =>
      bindScopedResult(await callback(context), context.i18n, scope),
    );
  }

  return {
    resolveLocale(input) {
      return resolveLocaleFromInput(input, options);
    },

    run,

    middleware() {
      const middleware: ReturnType<RemixI18nServer<TLocale>["middleware"]> = async (
        context,
        next,
      ) =>
        await run(
          {
            headers: context.headers,
            params: context.params,
            request: context.request,
          },
          async (palamedes) => {
            context.set(remixI18nContext, palamedes, { property: "palamedes" });
            return await next();
          },
        );
      return middleware;
    },

    get(context) {
      if (context) {
        return context.get(remixI18nContext) as
          | RemixI18nContextValue<TLocale, PalamedesI18n>
          | undefined;
      }

      const i18n = scope.get();
      return i18n ? scopedContexts.get(i18n) : undefined;
    },

    createClientCatalogAsset,

    renderClientCatalog,

    renderClientEntry,

    serveClientCatalogAsset,

    serializeLocaleCookie(locale) {
      return `${cookieName}=${locale}; Path=/; Max-Age=${cookieMaxAge}; SameSite=Lax`;
    },
  };
}

const REMOVED_CATALOG_VERSION_CALLBACK_MESSAGE =
  "Palamedes v2 removed the catalogVersion callback: catalog versions derive from the executable catalog asset. Pass a deployment version string, or omit catalogVersion to use the content digest.";
const RENAMED_CREATE_I18N_MESSAGE =
  "Palamedes v2 renamed the Remix createI18n option to i18nOptions: return the createI18n options for the request, such as { timeZone }, instead of an instance. Rename the option; the adapter creates the instance.";

function assertNoRemovedRemixServerOptions(options: object): void {
  const record = options as Record<string, unknown>;
  if (typeof record.catalogVersion === "function") {
    throw new TypeError(REMOVED_CATALOG_VERSION_CALLBACK_MESSAGE);
  }
  if (record.createI18n !== undefined) {
    throw new Error(RENAMED_CREATE_I18N_MESSAGE);
  }
}

/** The adapter-owned config type is a structural subset of the native catalog config. */
function toCatalogArtifactConfig(config: RemixCatalogAssetConfig): CatalogArtifactConfig {
  return config;
}

function resolveCatalogAssetVersion<TLocale extends string>(
  locale: TLocale,
  source: string,
  version: string | undefined,
): string {
  if (typeof version === "string" && version.length > 0) {
    return version;
  }
  // Asset sources contain executable message functions, so hash the exact
  // bytes delivered to the browser. This keeps cache invalidation stable
  // without trying to serialize or inspect function values.
  return createHash("sha256")
    .update(JSON.stringify([locale, source]))
    .digest("hex");
}

function catalogAssetPrefix(basePath: string): string {
  return `${basePath.replace(/\/$/u, "")}/__palamedes/catalog/`;
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function normalizeInput(input: RemixI18nRunInput): RemixLocaleResolutionInput {
  return input instanceof Request ? { request: input } : input;
}

function resolveLocaleFromInput<TLocale extends string>(
  input: RemixI18nRunInput,
  options: Pick<RemixI18nServerOptions<TLocale>, "locales" | "strategy" | "routeParam">,
): RemixResolvedLocale<TLocale> {
  const normalized = normalizeInput(input);
  const headers = normalized.headers ?? normalized.request.headers;
  const acceptLanguage = AcceptLanguage.from(headers.get("accept-language"));
  const acceptLanguageHeader = acceptLanguage.size > 0 ? acceptLanguage.toString() : null;
  const url = new URL(normalized.request.url);

  return options.locales.resolve({
    strategy: options.strategy,
    acceptLanguageHeader,
    cookieHeader: headers.get("cookie"),
    requestHost: headers.get("host"),
    routeLocale: normalized.params?.[options.routeParam ?? "locale"] ?? firstPathSegment(url),
  });
}

function firstPathSegment(url: URL): string | null {
  return url.pathname.split("/").filter(Boolean)[0] ?? null;
}

function bindScopedResult<Result, T extends I18nInstance>(
  result: Result,
  i18n: T,
  scope: ReturnType<typeof createServerI18nScope<T>>,
): Result {
  if (!(result instanceof Response) || !result.body) {
    return result;
  }

  return bindResponseBodyToScope(result, i18n, scope) as Result;
}

function bindResponseBodyToScope<T extends I18nInstance>(
  response: Response,
  i18n: T,
  scope: ReturnType<typeof createServerI18nScope<T>>,
): Response {
  if (!response.body) {
    return response;
  }

  const reader = response.body.getReader();
  const body = new ReadableStream({
    async pull(controller) {
      await scope.run(i18n, async () => {
        const chunk = await reader.read();
        if (chunk.done) {
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      });
    },

    async cancel(reason) {
      await scope.run(i18n, () => reader.cancel(reason));
    },
  });

  return new ScopedBodyResponse(body, response);
}

type ResponseFetchMetadata = Pick<Response, "redirected" | "type" | "url">;

class ScopedBodyResponse extends Response {
  readonly #fetchMetadata: ResponseFetchMetadata;

  public constructor(
    body: ReadableStream,
    response: Response,
    fetchMetadata?: ResponseFetchMetadata,
  ) {
    super(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
    this.#fetchMetadata = fetchMetadata ?? {
      redirected: response.redirected,
      type: response.type,
      url: response.url,
    };
  }

  public override get redirected(): boolean {
    return this.#fetchMetadata.redirected;
  }

  public override get type(): ResponseType {
    return this.#fetchMetadata.type;
  }

  public override get url(): string {
    return this.#fetchMetadata.url;
  }

  public override clone(): Response {
    const response = super.clone();
    if (!response.body) {
      return response;
    }

    return new ScopedBodyResponse(response.body, response, this.#fetchMetadata);
  }
}
