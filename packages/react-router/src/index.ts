import path from "node:path";
import { PassThrough, type Transform } from "node:stream";

import type { I18nInstance } from "@palamedes/runtime";
import { createServerI18nScope, type ServerI18nScope } from "@palamedes/runtime/server";
import type {
  BundledServerI18nOptions,
  createBundledServerI18n,
} from "@palamedes/runtime/server/bundled";
import { createViteCatalogDelivery } from "@palamedes/vite-plugin/delivery";
import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import { createElement } from "react";
import { renderToPipeableStream, type RenderToPipeableStreamOptions } from "react-dom/server";
import {
  createContext,
  ServerRouter,
  type EntryContext,
  type MiddlewareFunction,
  type RouterContextProvider,
} from "react-router";

/** Selects the active locale for one request. Locale policy stays in the application. */
export type ReactRouterLocaleResolver<TLocale extends string = string> = (
  request: Request,
) => TLocale | Promise<TLocale>;

/** Request-local `createI18n` options other than the locale, such as `timeZone`. */
export type ReactRouterI18nOptions = Omit<BundledServerI18nOptions, "locale">;

/** Production catalog delivery for the documents rendered by `handleRequest`. */
export type ReactRouterCatalogDeliveryOptions = {
  /** The client build directory; defaults to `build/client` in the process working directory. */
  readonly clientDirectory?: string;
  /** Skip the client manifest; defaults to `process.env.NODE_ENV !== "production"`. */
  readonly development?: boolean;
  /** Override the generated manifest filename for a custom Vite output. */
  readonly manifestName?: string;
  /** Trusted, catalog-independent markup shown when a browser catalog fails to load. */
  readonly errorHtml?: string;
};

export type CreateReactRouterI18nOptions<TLocale extends string = string> = {
  /** Pick the locale for a request, for example from a cookie, path segment, or host. */
  readonly resolveLocale: ReactRouterLocaleResolver<TLocale>;
  /** Formatting options for the request's i18n instance, or a function that returns them. */
  readonly i18nOptions?:
    | ReactRouterI18nOptions
    | ((
        request: Request,
        locale: TLocale,
      ) => ReactRouterI18nOptions | Promise<ReactRouterI18nOptions>);
  /** Catalog delivery options, or `false` when the host injects the import map itself. */
  readonly catalogDelivery?: ReactRouterCatalogDeliveryOptions | false;
  /** Resolve a CSP nonce for React's scripts, the import map, and the readiness script. */
  readonly nonce?: (request: Request) => string | undefined;
  /** Milliseconds before a streaming render is aborted, minus one second; defaults to 5000. */
  readonly streamTimeout?: number;
  /** Message of the error thrown when the request's catalog cannot be loaded. */
  readonly failureMessage?: string;
};

/** React Router's server entry signature in Framework Mode. */
export type ReactRouterHandleRequest = (
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
  loadContext: RouterContextProvider,
) => Promise<Response>;

/** The request context a route module receives in its `loader`, `action`, or `middleware`. */
export type ReactRouterContext = Readonly<RouterContextProvider>;

export type ReactRouterI18n<TLocale extends string = string> = {
  /**
   * Root route middleware. Export it from `app/root.tsx` as
   * `export const middleware = [i18n.middleware]`; every loader, action, and
   * document render below it then runs with the request's i18n instance.
   */
  readonly middleware: MiddlewareFunction<Response>;
  /**
   * A complete streaming server entry. Use it as the default export of
   * `app/entry.server.tsx`. It renders inside the request scope and adds the
   * locale's catalog import map and readiness script to the document.
   */
  readonly handleRequest: ReactRouterHandleRequest;
  /** The locale the middleware resolved for this request. */
  getLocale(context: ReactRouterContext): TLocale;
  /** Custom entries: run `work` inside the request's i18n scope. */
  run<Result>(
    request: Request,
    context: ReactRouterContext,
    work: () => Result | Promise<Result>,
  ): Promise<Result>;
  /** Custom entries: the document transform for the request's locale. */
  createDocumentTransform(request: Request, context: ReactRouterContext): Promise<Transform>;
  /** The adapter's server i18n scope, created once per `createReactRouterI18n()` call. */
  readonly scope: ServerI18nScope<I18nInstance>;
};

type RequestState<TLocale extends string> = {
  locale?: TLocale;
  i18n?: I18nInstance;
  error?: unknown;
};

const DEFAULT_FAILURE_MESSAGE =
  "Palamedes React Router i18n initialization failed before the route handlers ran.";
const DEFAULT_STREAM_TIMEOUT = 5000;
const MISSING_MIDDLEWARE_MESSAGE =
  "Palamedes React Router i18n has no locale for this request. Export `middleware = [i18n.middleware]` from app/root.tsx.";

type BundledRuntime = { createBundledServerI18n: typeof createBundledServerI18n };

let bundledRuntime: Promise<BundledRuntime> | undefined;

/**
 * Load the bundled server runtime on first use, so the package entry stays
 * importable outside a Vite server build, which supplies the generated server
 * catalogs. Concurrent first requests share one import.
 */
function loadBundledRuntime() {
  bundledRuntime ??= import("@palamedes/runtime/server/bundled").catch((error: unknown) => {
    bundledRuntime = undefined;
    throw error;
  });
  return bundledRuntime;
}

/**
 * Create the React Router Framework Mode integration once per server process,
 * in a server-only module such as `app/lib/i18n.server.ts`.
 */
export function createReactRouterI18n<TLocale extends string = string>(
  options: CreateReactRouterI18nOptions<TLocale>,
): ReactRouterI18n<TLocale> {
  const failureMessage = options.failureMessage ?? DEFAULT_FAILURE_MESSAGE;
  const streamTimeout = options.streamTimeout ?? DEFAULT_STREAM_TIMEOUT;
  // One scope per adapter instance: every scope owns an AsyncLocalStorage, and
  // Node keeps each enabled store for the lifetime of the process.
  const scope = createServerI18nScope<I18nInstance>();
  // React Router passes the same RouterContextProvider to middleware, loaders,
  // actions, and the server entry, so it carries the request's state.
  const stateContext = createContext<RequestState<TLocale> | null>(null);
  const deliveryOptions = options.catalogDelivery === false ? undefined : options.catalogDelivery;
  const development = deliveryOptions?.development ?? process.env.NODE_ENV !== "production";
  const delivery =
    options.catalogDelivery === false
      ? undefined
      : createViteCatalogDelivery({
          clientDirectory:
            deliveryOptions?.clientDirectory ?? path.resolve(process.cwd(), "build/client"),
          development,
          ...(deliveryOptions?.manifestName ? { manifestName: deliveryOptions.manifestName } : {}),
        });

  async function resolveState(
    request: Request,
    context: ReactRouterContext,
  ): Promise<RequestState<TLocale>> {
    const state: RequestState<TLocale> = {};
    // Store the state before loading the catalog so a failed load still leaves
    // the locale for the error document's import map.
    context.set(stateContext, state);
    try {
      const locale = await options.resolveLocale(request);
      state.locale = locale;
      const i18nOptions =
        typeof options.i18nOptions === "function"
          ? await options.i18nOptions(request, locale)
          : options.i18nOptions;
      const { createBundledServerI18n } = await loadBundledRuntime();
      state.i18n = await createBundledServerI18n({ ...i18nOptions, locale });
    } catch (error) {
      state.error = new Error(failureMessage, { cause: error });
      throw state.error;
    }
    return state;
  }

  async function run<Result>(
    request: Request,
    context: ReactRouterContext,
    work: () => Result | Promise<Result>,
  ): Promise<Result> {
    const state = context.get(stateContext) ?? (await resolveState(request, context));
    // A recorded failure was already thrown to React Router, which now renders
    // the error boundary. That render must not depend on the missing catalog.
    if (!state.i18n) return await work();
    const i18n = state.i18n;
    return await scope.run(i18n, async () => await work());
  }

  async function createDocumentTransform(
    request: Request,
    context: ReactRouterContext,
  ): Promise<Transform> {
    if (!delivery) return new PassThrough();
    const state = context.get(stateContext) ?? (await resolveState(request, context));
    const binding = state.locale === undefined ? null : delivery.getLocaleBinding(state.locale);
    const nonce = options.nonce?.(request);
    return delivery.createDocumentTransform(binding, {
      ...(nonce ? { nonce } : {}),
      ...(deliveryOptions?.errorHtml ? { errorHtml: deliveryOptions.errorHtml } : {}),
    });
  }

  const middleware: MiddlewareFunction<Response> = async ({ request, context }, next) => {
    const existing = context.get(stateContext);
    if (existing?.error) throw existing.error;
    const state = existing ?? (await resolveState(request, context));
    const i18n = state.i18n;
    if (!i18n) return await next();
    return await scope.run(i18n, async () => await next());
  };

  const handleRequest: ReactRouterHandleRequest = async (
    request,
    responseStatusCode,
    responseHeaders,
    routerContext,
    loadContext,
  ) => {
    // https://httpwg.org/specs/rfc9110.html#HEAD
    if (request.method.toUpperCase() === "HEAD") {
      return new Response(null, { status: responseStatusCode, headers: responseHeaders });
    }

    // Requests that never reach route middleware (404 and 405 responses)
    // resolve their scope here instead.
    return await run(request, loadContext, async () => {
      const documentTransform = await createDocumentTransform(request, loadContext);
      const nonce = options.nonce?.(request);
      return await renderDocument({
        documentTransform,
        nonce,
        request,
        responseHeaders,
        responseStatusCode,
        routerContext,
        streamTimeout,
      });
    });
  };

  return {
    middleware,
    handleRequest,
    getLocale(context) {
      const locale = context.get(stateContext)?.locale;
      if (locale === undefined) throw new Error(MISSING_MIDDLEWARE_MESSAGE);
      return locale;
    },
    run,
    createDocumentTransform,
    scope,
  };
}

type RenderDocumentOptions = {
  documentTransform: Transform;
  nonce: string | undefined;
  request: Request;
  responseHeaders: Headers;
  responseStatusCode: number;
  routerContext: EntryContext;
  streamTimeout: number;
};

/**
 * React Router's default Node streaming entry, with the HTML piped through the
 * catalog document transform before it reaches the response body.
 */
function renderDocument({
  documentTransform,
  nonce,
  request,
  responseHeaders,
  responseStatusCode,
  routerContext,
  streamTimeout,
}: RenderDocumentOptions): Promise<Response> {
  return new Promise((resolve, reject) => {
    let statusCode = responseStatusCode;
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");
    // Bots and SPA Mode renders wait for all content before responding.
    const readyOption: keyof RenderToPipeableStreamOptions =
      (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";
    // Abort after the stream timeout so rejected boundaries can still flush.
    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => abort(),
      streamTimeout + 1000,
    );

    const { pipe, abort } = renderToPipeableStream(
      createElement(ServerRouter, {
        context: routerContext,
        url: request.url,
        ...(nonce ? { nonce } : {}),
      }),
      {
        ...(nonce ? { nonce } : {}),
        [readyOption]() {
          shellRendered = true;
          const body = new PassThrough({
            final(callback) {
              clearTimeout(timeoutId);
              timeoutId = undefined;
              callback();
            },
          });
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          documentTransform.pipe(body);
          pipe(documentTransform);
          resolve(new Response(stream, { headers: responseHeaders, status: statusCode }));
        },
        onShellError(error: unknown) {
          clearTimeout(timeoutId);
          reject(error);
        },
        onError(error: unknown) {
          statusCode = 500;
          // Shell errors reject and React Router logs them; log streaming
          // errors from inside the shell here.
          if (shellRendered) console.error(error);
        },
      },
    );
  });
}
