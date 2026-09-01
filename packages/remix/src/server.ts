import { createHash } from "node:crypto"

import {
  createI18n,
  type CatalogMessages,
  type CompiledCatalogMessages,
  type PalamedesI18n,
} from "@palamedes/core"
import type { LocaleControls, LocaleSource } from "@palamedes/core/locale"
import type { I18nInstance } from "@palamedes/runtime"
import { createScopedI18nRunner, createServerI18nScope } from "@palamedes/runtime/server"
import { AcceptLanguage } from "remix/headers"
import { createContextKey, type Middleware, type RequestContext } from "remix/router"

import { REMIX_I18N_BOOTSTRAP_ID, type RemixI18nBootstrap } from "./client"

export type RemixI18nResolver<T extends I18nInstance = I18nInstance> = (
  request: Request
) => T | Promise<T>

export type RemixI18nRequestScope<T extends I18nInstance = I18nInstance> = {
  run<Result>(request: Request, callback: (i18n: T) => Result | Promise<Result>): Promise<Result>
  activate(i18n: T): T
  get(): T | undefined
}

export type RemixLocaleStrategy = "cookie" | "route" | "subdomain" | "tld"

export type RemixLocaleResolutionInput = {
  headers?: Headers
  params?: Record<string, string | undefined>
  request: Request
}

type RemixI18nRunInput = Request | RemixLocaleResolutionInput | RequestContext<any, any>
type RemixContextKey<T> = {
  defaultValue?: T
}

export type RemixResolvedLocale<TLocale extends string> = {
  locale: TLocale
  source: LocaleSource
}

export type RemixI18nContextValue<
  TLocale extends string = string,
  T extends I18nInstance = I18nInstance,
> = {
  i18n: T
  locale: TLocale
  source: LocaleSource
}

export type RemixI18nServerOptions<
  TLocale extends string,
  T extends PalamedesI18n = PalamedesI18n,
> = {
  locales: LocaleControls<TLocale>
  strategy: RemixLocaleStrategy
  loadMessages: (locale: TLocale) => CatalogMessages | CompiledCatalogMessages
  /**
   * Load serializable ICU strings for the browser document. Defaults to
   * `loadMessages`; provide this separately when server catalogs contain
   * executable compiled messages.
   */
  loadClientMessages?: (locale: TLocale) => CatalogMessages
  /** Override the deterministic content hash used for client catalog versions. */
  catalogVersion?: string | ((input: { locale: TLocale; messages: CatalogMessages }) => string)
  createI18n?: () => T
  routeParam?: string
  cookieName?: string
  cookieMaxAge?: number
}

export type RemixI18nServer<TLocale extends string, T extends PalamedesI18n = PalamedesI18n> = {
  resolveLocale(input: RemixI18nRunInput): RemixResolvedLocale<TLocale>
  createI18n(locale: TLocale): T
  run<Result>(
    input: RemixI18nRunInput,
    callback: (context: RemixI18nContextValue<TLocale, T>) => Result | Promise<Result>
  ): Promise<Result>
  middleware(): Middleware<{
    key: typeof remixI18nContext
    value: RemixI18nContextValue<TLocale, T>
    property: "palamedes"
  }>
  get(context?: RequestContext<any, any>): RemixI18nContextValue<TLocale, T> | undefined
  createClientBootstrap(locale: TLocale): RemixI18nBootstrap<TLocale>
  renderClientBootstrap(locale: TLocale, options?: { elementId?: string }): string
  serializeLocaleCookie(locale: TLocale): string
}

export const remixI18nContext: RemixContextKey<RemixI18nContextValue<string, I18nInstance>> =
  createContextKey<RemixI18nContextValue<string, I18nInstance>>()

export function createRemixI18nRequestScope<T extends I18nInstance = I18nInstance>(
  resolveI18n: RemixI18nResolver<T>
): RemixI18nRequestScope<T> {
  const runner = createScopedI18nRunner(resolveI18n, {
    failureMessage: "Palamedes Remix i18n initialization failed before the handler ran.",
  })

  return {
    async run(request, callback) {
      return await runner.run(request, async (i18n) =>
        bindScopedResult(await callback(i18n), i18n, runner.scope)
      )
    },

    activate(i18n) {
      return runner.scope.activate(i18n)
    },

    get() {
      return runner.scope.get()
    },
  }
}

export function createRemixI18nServer<
  TLocale extends string,
  T extends PalamedesI18n = PalamedesI18n,
>(options: RemixI18nServerOptions<TLocale, T>): RemixI18nServer<TLocale, T> {
  const scope = createServerI18nScope<T>()
  const catalogCache = new Map<TLocale, CatalogMessages | CompiledCatalogMessages>()
  const clientBootstrapCache = new Map<TLocale, RemixI18nBootstrap<TLocale>>()
  const scopedContexts = new WeakMap<T, RemixI18nContextValue<TLocale, T>>()
  const createI18nInstance = options.createI18n ?? (() => createI18n() as unknown as T)
  const cookieName = options.cookieName ?? "locale"
  const cookieMaxAge = options.cookieMaxAge ?? 60 * 60 * 24 * 365

  const getMessages = (locale: TLocale): CatalogMessages | CompiledCatalogMessages => {
    const cached = catalogCache.get(locale)
    if (cached) {
      return cached
    }

    const messages = options.loadMessages(locale)
    catalogCache.set(locale, messages)
    return messages
  }

  const createScopedContext = (input: Request | RemixLocaleResolutionInput) => {
    const resolved = resolveLocaleFromInput(input, options)
    const i18n = createI18nInstance()
    i18n.load(resolved.locale, getMessages(resolved.locale))
    i18n.activate(resolved.locale)

    const context = {
      i18n,
      locale: resolved.locale,
      source: resolved.source,
    }
    scopedContexts.set(i18n, context)
    return context
  }

  const createClientBootstrap = (locale: TLocale): RemixI18nBootstrap<TLocale> => {
    const cached = clientBootstrapCache.get(locale)
    if (cached) {
      return cached
    }

    const messages = validateClientMessages(
      locale,
      options.loadClientMessages ? options.loadClientMessages(locale) : getMessages(locale)
    )
    const catalogVersion = resolveCatalogVersion(locale, messages, options.catalogVersion)
    const bootstrap = Object.freeze({ locale, catalogVersion, messages })
    clientBootstrapCache.set(locale, bootstrap)
    return bootstrap
  }

  async function run<Result>(
    input: RemixI18nRunInput,
    callback: (context: RemixI18nContextValue<TLocale, T>) => Result | Promise<Result>
  ): Promise<Result> {
    const context = createScopedContext(input)
    return await scope.run(context.i18n, async () =>
      bindScopedResult(await callback(context), context.i18n, scope)
    )
  }

  return {
    resolveLocale(input) {
      return resolveLocaleFromInput(input, options)
    },

    createI18n(locale) {
      const i18n = createI18nInstance()
      i18n.load(locale, getMessages(locale))
      i18n.activate(locale)
      return i18n
    },

    run,

    middleware() {
      const middleware: ReturnType<RemixI18nServer<TLocale, T>["middleware"]> = async (
        context,
        next
      ) =>
        await run(
          {
            headers: context.headers,
            params: context.params,
            request: context.request,
          },
          async (palamedes) => {
            context.set(remixI18nContext, palamedes, { property: "palamedes" })
            return await next()
          }
        )
      return middleware
    },

    get(context) {
      if (context) {
        return context.get(remixI18nContext) as RemixI18nContextValue<TLocale, T> | undefined
      }

      const i18n = scope.get()
      return i18n ? scopedContexts.get(i18n) : undefined
    },

    createClientBootstrap,

    renderClientBootstrap(locale, renderOptions = {}) {
      const elementId = renderOptions.elementId ?? REMIX_I18N_BOOTSTRAP_ID
      return `<template id="${escapeHtmlAttribute(elementId)}">${serializeBootstrap(createClientBootstrap(locale))}</template>`
    },

    serializeLocaleCookie(locale) {
      return `${cookieName}=${locale}; Path=/; Max-Age=${cookieMaxAge}; SameSite=Lax`
    },
  }
}

function validateClientMessages<TLocale extends string>(
  locale: TLocale,
  messages: unknown
): CatalogMessages {
  if (!isPlainMessageObject(messages)) {
    throw new TypeError(
      `Palamedes Remix client catalog for locale "${locale}" must be an object containing ICU strings.`
    )
  }

  const serializable: CatalogMessages = Object.create(null) as CatalogMessages
  for (const [id, message] of Object.entries(messages)) {
    if (typeof message !== "string") {
      throw new TypeError(
        `Palamedes Remix client catalog for locale "${locale}" contains non-string message "${id}". Supply loadClientMessages() with serializable ICU strings, for example compileCatalogArtifact(...).messages.`
      )
    }
    serializable[id] = message
  }
  return Object.freeze(serializable)
}

function resolveCatalogVersion<TLocale extends string>(
  locale: TLocale,
  messages: CatalogMessages,
  version: RemixI18nServerOptions<TLocale>["catalogVersion"]
): string {
  const resolved =
    typeof version === "function"
      ? version({ locale, messages })
      : (version ?? hashCatalog(locale, messages))
  if (typeof resolved !== "string" || resolved.length === 0) {
    throw new TypeError("Palamedes Remix client catalog version must be a non-empty string.")
  }
  return resolved
}

function hashCatalog(locale: string, messages: CatalogMessages): string {
  const entries = Object.entries(messages).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  )
  return createHash("sha256")
    .update(JSON.stringify([locale, entries]))
    .digest("hex")
}

function serializeBootstrap(bootstrap: RemixI18nBootstrap): string {
  return JSON.stringify(bootstrap)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")
}

function escapeHtmlAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;")
}

function isPlainMessageObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function normalizeInput(input: RemixI18nRunInput): RemixLocaleResolutionInput {
  return input instanceof Request ? { request: input } : input
}

function resolveLocaleFromInput<TLocale extends string>(
  input: RemixI18nRunInput,
  options: Pick<RemixI18nServerOptions<TLocale>, "locales" | "strategy" | "routeParam">
): RemixResolvedLocale<TLocale> {
  const normalized = normalizeInput(input)
  const headers = normalized.headers ?? normalized.request.headers
  const acceptLanguage = AcceptLanguage.from(headers.get("accept-language"))
  const acceptLanguageHeader = acceptLanguage.size > 0 ? acceptLanguage.toString() : null
  const url = new URL(normalized.request.url)

  return options.locales.resolve({
    strategy: options.strategy,
    acceptLanguageHeader,
    cookieHeader: headers.get("cookie"),
    requestHost: headers.get("host"),
    routeLocale: normalized.params?.[options.routeParam ?? "locale"] ?? firstPathSegment(url),
  })
}

function firstPathSegment(url: URL): string | null {
  return url.pathname.split("/").filter(Boolean)[0] ?? null
}

function bindScopedResult<Result, T extends I18nInstance>(
  result: Result,
  i18n: T,
  scope: ReturnType<typeof createServerI18nScope<T>>
): Result {
  if (!(result instanceof Response) || !result.body) {
    return result
  }

  return bindResponseBodyToScope(result, i18n, scope) as Result
}

function bindResponseBodyToScope<T extends I18nInstance>(
  response: Response,
  i18n: T,
  scope: ReturnType<typeof createServerI18nScope<T>>
): Response {
  if (!response.body) {
    return response
  }

  const reader = response.body.getReader()
  const body = new ReadableStream({
    async pull(controller) {
      await scope.run(i18n, async () => {
        const chunk = await reader.read()
        if (chunk.done) {
          controller.close()
        } else {
          controller.enqueue(chunk.value)
        }
      })
    },

    async cancel(reason) {
      await scope.run(i18n, () => reader.cancel(reason))
    },
  })

  return new ScopedBodyResponse(body, response)
}

type ResponseFetchMetadata = Pick<Response, "redirected" | "type" | "url">

class ScopedBodyResponse extends Response {
  readonly #fetchMetadata: ResponseFetchMetadata

  public constructor(
    body: ReadableStream,
    response: Response,
    fetchMetadata?: ResponseFetchMetadata
  ) {
    super(body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
    this.#fetchMetadata = fetchMetadata ?? {
      redirected: response.redirected,
      type: response.type,
      url: response.url,
    }
  }

  public override get redirected(): boolean {
    return this.#fetchMetadata.redirected
  }

  public override get type(): ResponseType {
    return this.#fetchMetadata.type
  }

  public override get url(): string {
    return this.#fetchMetadata.url
  }

  public override clone(): Response {
    const response = super.clone()
    if (!response.body) {
      return response
    }

    return new ScopedBodyResponse(response.body, response, this.#fetchMetadata)
  }
}
