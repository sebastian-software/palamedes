import { createI18n, type CatalogMessages, type PalamedesI18n } from "@palamedes/core"
import type { LocaleControls, LocaleSource } from "@palamedes/core/locale"
import type { I18nInstance } from "@palamedes/runtime"
import { createServerI18nScope } from "@palamedes/runtime/server"
import { AcceptLanguage } from "remix/headers"
import { createContextKey, type Middleware, type RequestContext } from "remix/router"

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
  loadMessages: (locale: TLocale) => CatalogMessages
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
  serializeLocaleCookie(locale: TLocale): string
}

export const remixI18nContext: RemixContextKey<RemixI18nContextValue<string, I18nInstance>> =
  createContextKey<RemixI18nContextValue<string, I18nInstance>>()

export function createRemixI18nRequestScope<T extends I18nInstance = I18nInstance>(
  resolveI18n: RemixI18nResolver<T>
): RemixI18nRequestScope<T> {
  const scope = createServerI18nScope<T>()

  return {
    async run(request, callback) {
      const i18n = await resolveI18n(request)
      return await scope.run(i18n, async () => bindScopedResult(await callback(i18n), i18n, scope))
    },

    activate(i18n) {
      return scope.activate(i18n)
    },

    get() {
      return scope.get()
    },
  }
}

export function createRemixI18nServer<
  TLocale extends string,
  T extends PalamedesI18n = PalamedesI18n,
>(options: RemixI18nServerOptions<TLocale, T>): RemixI18nServer<TLocale, T> {
  const scope = createServerI18nScope<T>()
  const catalogCache = new Map<TLocale, CatalogMessages>()
  const createI18nInstance = options.createI18n ?? (() => createI18n() as unknown as T)
  const cookieName = options.cookieName ?? "locale"
  const cookieMaxAge = options.cookieMaxAge ?? 60 * 60 * 24 * 365

  const getMessages = (locale: TLocale): CatalogMessages => {
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

    return {
      i18n,
      locale: resolved.locale,
      source: resolved.source,
    }
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
      return (async (context, next) =>
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
        )) as RemixI18nServer<TLocale, T>["middleware"] extends () => infer TMiddleware
        ? TMiddleware
        : never
    },

    get(context) {
      if (context) {
        return context.get(remixI18nContext) as RemixI18nContextValue<TLocale, T> | undefined
      }

      const i18n = scope.get()
      return i18n
        ? ({ i18n, locale: i18n.locale as TLocale, source: "default" } as const)
        : undefined
    },

    serializeLocaleCookie(locale) {
      return `${cookieName}=${locale}; Path=/; Max-Age=${cookieMaxAge}; SameSite=Lax`
    },
  }
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

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  })
}
