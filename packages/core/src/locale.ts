/**
 * Headless locale controls: resolution, the deliberate-choice cookie, and the
 * suggestion decision — all framework-agnostic and configurable. UI and router
 * navigation stay with the caller. See the RFC in
 * `docs/plans/2026-07-01-locale-controls-library-rfc.md`.
 */

export type LocaleSource = "accept-language" | "cookie" | "default" | "host" | "route"

/** Maps each locale to the host that canonically serves it (host strategy). */
export type HostLocaleConfig<TLocale extends string> = {
  locales: Partial<Record<TLocale, string>>
  defaultHost?: string | null
}

/** A UI-agnostic suggestion that the rendered locale differs from the intent. */
export type LocaleSuggestion<TLocale extends string> = {
  currentLocale: TLocale
  description: string
  reason: "accept-language" | "host"
  recommendedLocale: TLocale
  recommendedUrl: string
}

export type LocaleControlsConfig<TLocale extends string> = {
  /** Supported locales; the first is not special, `defaultLocale` decides. */
  locales: readonly TLocale[]
  /** Fallback when nothing else resolves. */
  defaultLocale: TLocale
  /** Display labels; defaults to `Intl.DisplayNames`, then the locale code. */
  labels?: Partial<Record<TLocale, string>>
  /** Cookie names; default to `locale` and `locale-choice`. */
  cookies?: {
    locale?: string
    choice?: string
  }
  /** Optional host strategy (locale per host). */
  hosts?: HostLocaleConfig<TLocale>
}

export type LocaleSwitchItem<TLocale extends string = string> = {
  active: boolean
  label: string
  locale: TLocale
  testId: string
}

export type BuildLocaleSwitchItemsOptions<TLocale extends string> = {
  currentLocale: TLocale
  labels?: Partial<Record<TLocale, string>>
  locales: readonly TLocale[]
  testIdPrefix?: string
}

const DEFAULT_LOCALE_COOKIE = "locale"
const DEFAULT_CHOICE_COOKIE = "locale-choice"
const CHOICE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

// ---------------------------------------------------------------------------
// Config-free helpers
// ---------------------------------------------------------------------------

function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) {
    return null
  }

  for (const segment of cookieHeader.split(";")) {
    const [rawKey, rawValue] = segment.split("=")
    if (rawKey?.trim() === name) {
      return rawValue?.trim() ?? null
    }
  }

  return null
}

/** Accept-Language tags sorted by quality, with base languages expanded. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) {
    return []
  }

  return header
    .split(",")
    .map((entry) => {
      const [tag, ...params] = entry.trim().split(";")
      const qParam = params.find((param) => param.trim().startsWith("q="))
      const quality = qParam ? Number(qParam.split("=")[1]) : 1

      return {
        quality: Number.isFinite(quality) ? quality : 1,
        tag: tag.toLowerCase(),
      }
    })
    .sort((left, right) => right.quality - left.quality)
    .flatMap(({ tag }) => {
      const base = tag.split("-")[0]
      return base && base !== tag ? [tag, base] : [tag]
    })
}

function stripPort(host: string | null | undefined): string | null {
  if (!host) {
    return null
  }

  return host.replace(/:\d+$/, "")
}

function getPort(host: string | null | undefined): string | null {
  if (!host) {
    return null
  }

  const match = host.match(/:(\d+)$/)
  return match?.[1] ?? null
}

function resolveLabels<TLocale extends string>(
  locales: readonly TLocale[],
  overrides?: Partial<Record<TLocale, string>>
): Record<TLocale, string> {
  const hasDisplayNames = typeof Intl.DisplayNames === "function"

  return Object.fromEntries(
    locales.map((locale) => {
      const override = overrides?.[locale]
      if (override) {
        return [locale, override]
      }

      if (hasDisplayNames) {
        const label = new Intl.DisplayNames([locale], { type: "language" }).of(locale)
        if (label) {
          return [locale, label]
        }
      }

      return [locale, locale]
    })
  ) as Record<TLocale, string>
}

/**
 * Build headless locale-switch items (locale, active, label, testId) to render
 * with any router. Re-exported by `@palamedes/react` / `@palamedes/solid`.
 */
export function buildLocaleSwitchItems<TLocale extends string>({
  currentLocale,
  labels,
  locales,
  testIdPrefix = "locale-switch",
}: BuildLocaleSwitchItemsOptions<TLocale>): Array<LocaleSwitchItem<TLocale>> {
  return locales.map((locale) => ({
    active: locale === currentLocale,
    label: labels?.[locale] ?? locale,
    locale,
    testId: `${testIdPrefix}-${locale}`,
  }))
}

// ---------------------------------------------------------------------------
// Bound controls
// ---------------------------------------------------------------------------

export type LocaleControls<TLocale extends string> = {
  readonly locales: readonly TLocale[]
  readonly defaultLocale: TLocale
  readonly labels: Record<TLocale, string>

  isLocale(value: unknown): value is TLocale
  normalizeLocale(value: unknown): TLocale
  label(locale: TLocale): string
  preferredLocale(acceptLanguageHeader: string | null | undefined): TLocale

  /** Resolve the active locale for a request, per strategy. */
  resolve(options: {
    strategy: "cookie" | "route"
    acceptLanguageHeader?: string | null
    cookieHeader?: string | null
    routeLocale?: string | null
  }): { locale: TLocale; source: LocaleSource }

  /** The deliberate-choice cookie value, or null when unset/invalid. */
  readChoice(cookieHeader: string | null | undefined): TLocale | null
  /** A `document.cookie` string recording a deliberate choice. */
  serializeChoice(locale: TLocale): string

  /**
   * Decide whether to suggest another locale. Prefers a recorded choice over
   * the raw Accept-Language, so a deliberate decision silences the hint while
   * an unintended landing still gets informed once. Host mismatches are
   * independent of intent.
   */
  suggest(options: {
    currentLocale: TLocale
    acceptLanguageHeader?: string | null
    cookieHeader?: string | null
    pathname: string
    requestHost?: string | null
    search?: string | null
  }): LocaleSuggestion<TLocale> | null

  canonicalUrl(options: {
    locale: TLocale
    pathname: string
    requestHost?: string | null
    search?: string | null
  }): string

  replaceLocaleInPath(pathname: string, locale: TLocale): string
  extractLocaleFromPath(pathname: string): TLocale | null

  switchItems(options: {
    currentLocale: TLocale
    testIdPrefix?: string
  }): Array<LocaleSwitchItem<TLocale>>
}

export function defineLocaleControls<TLocale extends string>(
  config: LocaleControlsConfig<TLocale>
): LocaleControls<TLocale> {
  const localeCookie = config.cookies?.locale ?? DEFAULT_LOCALE_COOKIE
  const choiceCookie = config.cookies?.choice ?? DEFAULT_CHOICE_COOKIE
  const labels = resolveLabels(config.locales, config.labels)

  const isLocale = (value: unknown): value is TLocale =>
    typeof value === "string" && config.locales.includes(value as TLocale)

  const normalizeLocale = (value: unknown): TLocale =>
    isLocale(value) ? value : config.defaultLocale

  const label = (locale: TLocale): string => labels[locale]

  const preferredLocale = (header: string | null | undefined): TLocale => {
    for (const candidate of parseAcceptLanguage(header)) {
      if (isLocale(candidate)) {
        return candidate
      }
    }

    return config.defaultLocale
  }

  const readChoice = (cookieHeader: string | null | undefined): TLocale | null => {
    const value = readCookie(cookieHeader, choiceCookie)
    return isLocale(value) ? value : null
  }

  const readCookieLocale = (cookieHeader: string | null | undefined): TLocale | null => {
    const value = readCookie(cookieHeader, localeCookie)
    return value ? normalizeLocale(value) : null
  }

  const serializeChoice = (locale: TLocale): string =>
    `${choiceCookie}=${locale}; Path=/; Max-Age=${CHOICE_MAX_AGE_SECONDS}; SameSite=Lax`

  const resolve = (options: {
    strategy: "cookie" | "route"
    acceptLanguageHeader?: string | null
    cookieHeader?: string | null
    routeLocale?: string | null
  }): { locale: TLocale; source: LocaleSource } => {
    if (options.strategy === "route") {
      if (isLocale(options.routeLocale)) {
        return { locale: options.routeLocale, source: "route" }
      }
    } else {
      const cookieLocale = readCookieLocale(options.cookieHeader)
      if (cookieLocale) {
        return { locale: cookieLocale, source: "cookie" }
      }
    }

    const acceptLanguageLocale = preferredLocale(options.acceptLanguageHeader)
    return {
      locale: acceptLanguageLocale,
      source: acceptLanguageLocale === config.defaultLocale ? "default" : "accept-language",
    }
  }

  const replaceLocaleInPath = (pathname: string, locale: TLocale): string => {
    const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`
    const segments = normalizedPathname.split("/").filter(Boolean)

    if (segments.length > 0 && isLocale(segments[0])) {
      segments[0] = locale
    } else {
      segments.unshift(locale)
    }

    return `/${segments.join("/")}`
  }

  const extractLocaleFromPath = (pathname: string): TLocale | null => {
    const firstSegment = pathname.split("/").filter(Boolean)[0]
    return isLocale(firstSegment) ? firstSegment : null
  }

  const resolveHostLocale = (requestHost: string | null | undefined): TLocale | null => {
    if (!config.hosts) {
      return null
    }

    const normalizedHost = stripPort(requestHost)
    if (!normalizedHost) {
      return null
    }

    for (const locale of config.locales) {
      if (stripPort(config.hosts.locales[locale]) === normalizedHost) {
        return locale
      }
    }

    if (config.hosts.defaultHost && normalizedHost === stripPort(config.hosts.defaultHost)) {
      return config.defaultLocale
    }

    return null
  }

  const getCanonicalHost = (locale: TLocale, fallbackHost?: string | null): string | null =>
    config.hosts?.locales[locale] ?? stripPort(fallbackHost) ?? config.hosts?.defaultHost ?? null

  const canonicalUrl = (options: {
    locale: TLocale
    pathname: string
    requestHost?: string | null
    search?: string | null
  }): string => {
    const canonicalPath = replaceLocaleInPath(options.pathname, options.locale)
    const canonicalHost = config.hosts
      ? getCanonicalHost(options.locale, options.requestHost)
      : null
    const requestPort = getPort(options.requestHost)

    if (!canonicalHost) {
      return `${canonicalPath}${options.search ?? ""}`
    }

    const hostWithPort =
      requestPort && !canonicalHost.includes(":")
        ? `${canonicalHost}:${requestPort}`
        : canonicalHost

    return `http://${hostWithPort}${canonicalPath}${options.search ?? ""}`
  }

  const suggest = (options: {
    currentLocale: TLocale
    acceptLanguageHeader?: string | null
    cookieHeader?: string | null
    pathname: string
    requestHost?: string | null
    search?: string | null
  }): LocaleSuggestion<TLocale> | null => {
    const hostLocale = resolveHostLocale(options.requestHost)

    if (hostLocale && hostLocale !== options.currentLocale) {
      return {
        currentLocale: options.currentLocale,
        description: `This host is mapped to ${label(hostLocale)} while the URL is rendering ${label(options.currentLocale)}.`,
        reason: "host",
        recommendedLocale: hostLocale,
        recommendedUrl: canonicalUrl({
          locale: hostLocale,
          pathname: options.pathname,
          requestHost: options.requestHost,
          search: options.search,
        }),
      }
    }

    const choice = readChoice(options.cookieHeader)
    const preferred = choice ?? preferredLocale(options.acceptLanguageHeader)
    if (preferred === options.currentLocale) {
      return null
    }

    return {
      currentLocale: options.currentLocale,
      description: `You prefer ${label(preferred)}, but this page is currently rendering ${label(options.currentLocale)}.`,
      reason: "accept-language",
      recommendedLocale: preferred,
      recommendedUrl: canonicalUrl({
        locale: preferred,
        pathname: options.pathname,
        requestHost: options.requestHost,
        search: options.search,
      }),
    }
  }

  const switchItems = (options: {
    currentLocale: TLocale
    testIdPrefix?: string
  }): Array<LocaleSwitchItem<TLocale>> =>
    buildLocaleSwitchItems({
      currentLocale: options.currentLocale,
      labels,
      locales: config.locales,
      testIdPrefix: options.testIdPrefix,
    })

  return {
    locales: config.locales,
    defaultLocale: config.defaultLocale,
    labels,
    isLocale,
    normalizeLocale,
    label,
    preferredLocale,
    resolve,
    readChoice,
    serializeChoice,
    suggest,
    canonicalUrl,
    replaceLocaleInPath,
    extractLocaleFromPath,
    switchItems,
  }
}
