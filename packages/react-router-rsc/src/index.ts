import type { I18nInstance } from "@palamedes/runtime";
import { getI18n } from "@palamedes/runtime";
import {
  createViteCatalogDelivery,
  type ViteCatalogDeliveryOptions,
} from "@palamedes/vite-plugin/delivery";
import { Transform } from "node:stream";
import { createScopedI18nRunner, type ServerI18nScope } from "@palamedes/runtime/server";

/** Resolves a fresh, activated i18n instance from React Router's original Fetch request. */
export type ReactRouterRscI18nResolver<T extends I18nInstance = I18nInstance> = (
  request: Request,
) => T | Promise<T>;

/** Runs the complete React Router RSC entry request inside a request-local i18n scope. */
export type ReactRouterRscI18nRequestScope<T extends I18nInstance = I18nInstance> = {
  run<Result>(request: Request, dispatch: () => Result | Promise<Result>): Promise<Result>;
  scope: ServerI18nScope<T>;
};

export type ReactRouterRscCatalogDeliveryOptions = ViteCatalogDeliveryOptions & {
  /** Trusted catalog-independent markup rendered when a client catalog fails. */
  readonly errorHtml?: string;
  /** CSP nonce for adapter-owned inline import-map/probe elements. */
  readonly nonce?: string | ((request: Request) => string | undefined);
};

export type ReactRouterRscI18nRequestScopeOptions = {
  /** Inject the active locale import map into document responses after RSC renders. */
  readonly catalogDelivery?: ReactRouterRscCatalogDeliveryOptions;
};

/**
 * Creates the runtime boundary used by a custom React Router `entry.rsc.tsx`.
 *
 * Wrap React Router's default RSC `fetch()` call, not an individual Server
 * Function. The default entry starts `unstable_matchRSCServerRequest` after
 * this callback begins, so argument binding, Server Function dispatch, RSC
 * rendering, automatic revalidation, SSR, and streams created during that work
 * all inherit the same `AsyncLocalStorage` context.
 */
export function createReactRouterRscI18nRequestScope<T extends I18nInstance = I18nInstance>(
  resolveI18n: ReactRouterRscI18nResolver<T>,
  options: ReactRouterRscI18nRequestScopeOptions = {},
): ReactRouterRscI18nRequestScope<T> {
  const runner = createScopedI18nRunner(resolveI18n, {
    failureMessage:
      "Palamedes React Router RSC i18n initialization failed before RSC dispatch ran.",
  });
  const delivery = options.catalogDelivery
    ? createViteCatalogDelivery(options.catalogDelivery)
    : undefined;

  return {
    run(request, dispatch) {
      return runner.run(request, async () => {
        const result = await dispatch();
        return delivery
          ? transformDocumentResponse(
              result,
              delivery,
              options.catalogDelivery?.errorHtml,
              resolveNonce(options.catalogDelivery?.nonce, request),
            )
          : result;
      });
    },
    scope: runner.scope,
  };
}

function resolveNonce(
  nonce: ReactRouterRscCatalogDeliveryOptions["nonce"],
  request: Request,
): string | undefined {
  return typeof nonce === "function" ? nonce(request) : nonce;
}

function transformDocumentResponse<Result>(
  result: Result,
  delivery: ReturnType<typeof createViteCatalogDelivery>,
  errorHtml?: string,
  nonce?: string,
): Result {
  if (!(result instanceof Response) || !result.body) return result;
  if (!result.headers.get("content-type")?.toLowerCase().startsWith("text/html")) return result;

  const binding = delivery.getLocaleBinding(getI18n().locale);
  const body = result.body.pipeThrough(
    Transform.toWeb(
      delivery.createDocumentTransform(binding, {
        ...(errorHtml ? { errorHtml } : {}),
        ...(nonce ? { nonce } : {}),
      }),
    ) as unknown as ReadableWritablePair<Uint8Array, Uint8Array>,
  );
  const headers = new Headers(result.headers);
  headers.delete("content-length");
  return new Response(body, {
    headers,
    status: result.status,
    statusText: result.statusText,
  }) as Result;
}
