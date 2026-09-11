import { createHash } from "node:crypto";

import {
  createI18n,
  type CatalogMessages,
  type CompiledCatalogMessages,
  type PalamedesI18n,
} from "@palamedes/core";
import type { LocaleControls, LocaleSource } from "@palamedes/core/locale";
import {
  compileCatalogArtifact,
  compileCatalogModule,
  type CatalogArtifactConfig,
} from "@palamedes/core-node";
import type { I18nInstance } from "@palamedes/runtime";
import {
  createScopedI18nRunner,
  createServerCatalogStore,
  createServerI18nScope,
} from "@palamedes/runtime/server";
import { AcceptLanguage } from "remix/headers";
import { createContextKey, type Middleware, type RequestContext } from "remix/router";

import { REMIX_I18N_BOOTSTRAP_ID, type RemixI18nBootstrap } from "./client";
import type { PalamedesRemixCatalogAssetRegistry } from "./index";

export type RemixI18nResolver<T extends I18nInstance = I18nInstance> = (
  request: Request,
) => T | Promise<T>;

export type RemixI18nRequestScope<T extends I18nInstance = I18nInstance> = {
  run<Result>(request: Request, callback: (i18n: T) => Result | Promise<Result>): Promise<Result>;
  activate(i18n: T): T;
  get(): T | undefined;
};

export type RemixLocaleStrategy = "cookie" | "route" | "subdomain" | "tld";

export type RemixLocaleResolutionInput = {
  headers?: Headers;
  params?: Record<string, string | undefined>;
  request: Request;
};

type RemixI18nRunInput = Request | RemixLocaleResolutionInput | RequestContext<any, any>;
type RemixContextKey<T> = {
  defaultValue?: T;
};

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

export type RemixI18nServerOptions<
  TLocale extends string,
  T extends PalamedesI18n = PalamedesI18n,
> = {
  locales: LocaleControls<TLocale>;
  strategy: RemixLocaleStrategy;
  /** Synchronous or asynchronous executable catalog loader. Omit when using a registry. */
  loadMessages?: (locale: TLocale) => CompiledCatalogMessages | Promise<CompiledCatalogMessages>;
  /** Legacy inert ICU strings for migration diagnostics; #1214 replaces this with executable assets. */
  loadClientMessages?: (locale: TLocale) => CatalogMessages;
  /** Override the deterministic content hash used for client catalog versions. */
  catalogVersion?: string | ((input: { locale: TLocale; messages: CatalogMessages }) => string);
  /**
   * Configuration for adapter-owned executable browser catalog assets. The
   * adapter compiles the requested locale into an ESM module and serves it
   * through `serveClientCatalogAsset()`; no catalog functions cross JSON.
   */
  catalogAssets?: {
    config?: CatalogArtifactConfig;
    resolvePath?: (locale: TLocale) => string;
    basePath?: string;
    registry?: PalamedesRemixCatalogAssetRegistry;
    /** Override the client module URL when the Remix asset server uses custom mounts. */
    clientModuleUrl?: string;
  };
  createI18n?: () => T;
  routeParam?: string;
  cookieName?: string;
  cookieMaxAge?: number;
};

export type RemixI18nServer<TLocale extends string, T extends PalamedesI18n = PalamedesI18n> = {
  resolveLocale(input: RemixI18nRunInput): RemixResolvedLocale<TLocale>;
  createI18n(locale: TLocale): T;
  run<Result>(
    input: RemixI18nRunInput,
    callback: (context: RemixI18nContextValue<TLocale, T>) => Result | Promise<Result>,
  ): Promise<Result>;
  middleware(): Middleware<{
    key: typeof remixI18nContext;
    value: RemixI18nContextValue<TLocale, T>;
    property: "palamedes";
  }>;
  get(context?: RequestContext<any, any>): RemixI18nContextValue<TLocale, T> | undefined;
  createClientBootstrap(locale: TLocale): RemixI18nBootstrap<TLocale>;
  renderClientBootstrap(locale: TLocale, options?: { elementId?: string }): string;
  createClientCatalogAsset(locale: TLocale): RemixClientCatalogAsset<TLocale>;
  renderClientCatalog(locale: TLocale, options?: { basePath?: string }): string;
  /** Render an external, CSP-compatible adapter bootstrap for the application entry. */
  renderClientEntry(entryUrl: string, options?: { errorHtml?: string; nonce?: string }): string;
  serveClientCatalogAsset(request: Request): Response | undefined;
  serializeLocaleCookie(locale: TLocale): string;
};

export type RemixClientCatalogAsset<TLocale extends string = string> = {
  locale: TLocale;
  catalogVersion: string;
  source: string;
};

type CachedRemixClientCatalogAsset<TLocale extends string> = RemixClientCatalogAsset<TLocale> & {
  registryGeneration?: string;
};

export const remixI18nContext: RemixContextKey<RemixI18nContextValue<string, I18nInstance>> =
  createContextKey<RemixI18nContextValue<string, I18nInstance>>();

export function createRemixI18nRequestScope<T extends I18nInstance = I18nInstance>(
  resolveI18n: RemixI18nResolver<T>,
): RemixI18nRequestScope<T> {
  const runner = createScopedI18nRunner(resolveI18n, {
    failureMessage: "Palamedes Remix i18n initialization failed before the handler ran.",
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

export function createRemixI18nServer<
  TLocale extends string,
  T extends PalamedesI18n = PalamedesI18n,
>(options: RemixI18nServerOptions<TLocale, T>): RemixI18nServer<TLocale, T> {
  if (options.catalogAssets?.registry && typeof options.catalogVersion === "function") {
    throw new TypeError(
      "Remix registry catalog versions are derived from executable content. Remove the legacy messages callback or provide a deployment version string.",
    );
  }
  const scope = createServerI18nScope<T>();
  const catalogCache = new Map<TLocale, CompiledCatalogMessages>();
  const clientEntries = new Map<string, string>();
  const clientBootstrapCache = new Map<TLocale, RemixI18nBootstrap<TLocale>>();
  const clientCatalogAssetCache = new Map<TLocale, CachedRemixClientCatalogAsset<TLocale>>();
  const scopedContexts = new WeakMap<T, RemixI18nContextValue<TLocale, T>>();
  const createI18nInstance = options.createI18n ?? (() => createI18n() as unknown as T);
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
    clientBootstrapCache.clear();
    clientCatalogAssetCache.clear();
  };

  const getMessagesSync = (locale: TLocale): CompiledCatalogMessages => {
    refreshRegistryGeneration();
    const cached = catalogCache.get(locale);
    if (cached) {
      return cached;
    }

    if (!options.loadMessages) {
      throw new Error(
        "Palamedes Remix synchronous createI18n requires loadMessages. Use run(), which awaits the registry catalog, for adapter-owned async loading.",
      );
    }
    const messages = options.loadMessages(locale);
    if (isPromiseLike(messages)) {
      throw new Error(
        "Palamedes Remix synchronous createI18n cannot await an asynchronous catalog. Use run() or provide a synchronous loadMessages implementation.",
      );
    }
    catalogCache.set(locale, messages);
    return messages;
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

  const createScopedContext = async (input: Request | RemixLocaleResolutionInput) => {
    const resolved = resolveLocaleFromInput(input, options);
    const i18n = createI18nInstance();
    i18n.load(resolved.locale, await getMessages(resolved.locale));
    i18n.activate(resolved.locale);

    const context = {
      i18n,
      locale: resolved.locale,
      source: resolved.source,
    };
    scopedContexts.set(i18n, context);
    return context;
  };

  const createClientBootstrap = (locale: TLocale): RemixI18nBootstrap<TLocale> => {
    refreshRegistryGeneration();
    const cached = clientBootstrapCache.get(locale);
    if (cached) {
      return cached;
    }

    const messages = validateClientMessages(
      locale,
      options.loadClientMessages ? options.loadClientMessages(locale) : getMessagesSync(locale),
    );
    const catalogVersion = resolveCatalogVersion(locale, messages, options.catalogVersion);
    const bootstrap = Object.freeze({ locale, catalogVersion, messages });
    clientBootstrapCache.set(locale, bootstrap);
    return bootstrap;
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
      : compileCatalogModule(assetOptions.config!, resourcePath!, {
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
      !assetOptions.registry && typeof options.catalogVersion === "function"
        ? compileCatalogArtifact(assetOptions.config!, resourcePath!).messages
        : undefined,
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
    const href = `${basePath.replace(/\/$/u, "")}/__palamedes/catalog/${encodeURIComponent(locale)}.js`;
    return `<link rel="modulepreload" href="${escapeHtmlAttribute(href)}" data-palamedes-catalog-locale="${escapeHtmlAttribute(locale)}" data-palamedes-catalog-version="${escapeHtmlAttribute(createClientCatalogAsset(locale).catalogVersion)}" />`;
  };

  const renderClientEntry = (
    entryUrl: string,
    entryOptions: { errorHtml?: string; nonce?: string } = {},
  ): string => {
    const basePath = options.catalogAssets?.basePath ?? "/assets";
    const clientUrl =
      options.catalogAssets?.clientModuleUrl ??
      `${basePath.replace(/\/$/u, "")}/npm/@palamedes/remix/dist/client.mjs`;
    const source = `import{startRemixClient}from${JSON.stringify(clientUrl)};await startRemixClient(()=>import(${JSON.stringify(entryUrl)}),${JSON.stringify({ errorHtml: entryOptions.errorHtml })});`;
    const key = createHash("sha256").update(source).digest("hex");
    clientEntries.set(key, source);
    const src = `${basePath.replace(/\/$/u, "")}/__palamedes/entry/${key}.js`;
    return `<script type="module" src="${escapeHtmlAttribute(src)}"${entryOptions.nonce ? ` nonce="${escapeHtmlAttribute(entryOptions.nonce)}"` : ""}></script>`;
  };

  const serveClientCatalogAsset = (request: Request): Response | undefined => {
    const basePath = options.catalogAssets?.basePath ?? "/assets";
    const pathname = new URL(request.url).pathname;
    const entryPrefix = `${basePath.replace(/\/$/u, "")}/__palamedes/entry/`;
    if (pathname.startsWith(entryPrefix) && pathname.endsWith(".js")) {
      const source = clientEntries.get(pathname.slice(entryPrefix.length, -3));
      return source === undefined
        ? new Response("Unknown application entry.", { status: 404 })
        : new Response(source, {
            headers: {
              "content-type": "application/javascript; charset=utf-8",
              "cache-control": "no-cache",
            },
          });
    }
    const prefix = `${basePath.replace(/\/$/u, "")}/__palamedes/catalog/`;
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
    callback: (context: RemixI18nContextValue<TLocale, T>) => Result | Promise<Result>,
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

    createI18n(locale) {
      const i18n = createI18nInstance();
      i18n.load(locale, getMessagesSync(locale));
      i18n.activate(locale);
      return i18n;
    },

    run,

    middleware() {
      const middleware: ReturnType<RemixI18nServer<TLocale, T>["middleware"]> = async (
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
        return context.get(remixI18nContext) as RemixI18nContextValue<TLocale, T> | undefined;
      }

      const i18n = scope.get();
      return i18n ? scopedContexts.get(i18n) : undefined;
    },

    createClientBootstrap,

    createClientCatalogAsset,

    renderClientCatalog,

    renderClientEntry,

    serveClientCatalogAsset,

    renderClientBootstrap(locale, renderOptions = {}) {
      const elementId = renderOptions.elementId ?? REMIX_I18N_BOOTSTRAP_ID;
      return `<template id="${escapeHtmlAttribute(elementId)}">${serializeBootstrap(createClientBootstrap(locale))}</template>`;
    },

    serializeLocaleCookie(locale) {
      return `${cookieName}=${locale}; Path=/; Max-Age=${cookieMaxAge}; SameSite=Lax`;
    },
  };
}

function validateClientMessages<TLocale extends string>(
  locale: TLocale,
  messages: unknown,
): CatalogMessages {
  if (!isPlainMessageObject(messages)) {
    throw new TypeError(
      `Palamedes Remix client catalog for locale "${locale}" must be an object containing ICU strings.`,
    );
  }

  const serializable: CatalogMessages = Object.create(null) as CatalogMessages;
  for (const [id, message] of Object.entries(messages)) {
    if (typeof message !== "string") {
      throw new TypeError(
        `Palamedes Remix client catalog for locale "${locale}" contains non-string message "${id}". The legacy string transport cannot carry executable catalogs; migrate this host to the #1214 asset pipeline.`,
      );
    }
    serializable[id] = message;
  }
  return Object.freeze(serializable);
}

function resolveCatalogVersion<TLocale extends string>(
  locale: TLocale,
  messages: CatalogMessages,
  version: RemixI18nServerOptions<TLocale>["catalogVersion"],
): string {
  const resolved =
    typeof version === "function"
      ? version({ locale, messages })
      : (version ?? hashCatalog(locale, messages));
  if (typeof resolved !== "string" || resolved.length === 0) {
    throw new TypeError("Palamedes Remix client catalog version must be a non-empty string.");
  }
  return resolved;
}

function resolveCatalogAssetVersion<TLocale extends string>(
  locale: TLocale,
  source: string,
  version: RemixI18nServerOptions<TLocale>["catalogVersion"],
  messages?: CatalogMessages,
): string {
  const resolved =
    typeof version === "function"
      ? version({ locale, messages: messages ?? Object.create(null) })
      : version;
  if (typeof resolved === "string" && resolved.length > 0) {
    return resolved;
  }
  // Asset sources contain executable message functions, so hash the exact
  // bytes delivered to the browser. This keeps cache invalidation stable
  // without trying to serialize or inspect function values.
  return createHash("sha256")
    .update(JSON.stringify([locale, source]))
    .digest("hex");
}

function hashCatalog(locale: string, messages: CatalogMessages): string {
  const entries = Object.entries(messages).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return createHash("sha256")
    .update(JSON.stringify([locale, entries]))
    .digest("hex");
}

function serializeBootstrap(bootstrap: RemixI18nBootstrap): string {
  return JSON.stringify(bootstrap)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function isPlainMessageObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value;
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
