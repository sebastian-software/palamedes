export const DEFAULT_LOCALE = "en"
export const LOCALES = ["en", "de", "es"] as const
export const LOCALE_COOKIE = "locale"
// Records a deliberate locale decision (switcher click, banner CTA or dismiss)
// so the route strategy can stop suggesting the browser language once the user
// has made an explicit choice — while still informing on an unintended landing.
export const LOCALE_CHOICE_COOKIE = "locale-choice"

export type Locale = (typeof LOCALES)[number]
export type LocaleSource = "accept-language" | "cookie" | "default" | "host" | "route"

export type HostLocaleConfig = {
  locales: Partial<Record<Locale, string>>
  defaultHost?: string | null
}

export type LocaleBanner = {
  currentLocale: Locale
  description: string
  reason: "accept-language" | "host"
  recommendedLocale: Locale
  recommendedUrl: string
}

const FALLBACK_LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  es: "Español",
}

function createLocaleLabels(): Record<Locale, string> {
  if (typeof Intl.DisplayNames !== "function") {
    return FALLBACK_LOCALE_LABELS
  }

  return Object.fromEntries(
    LOCALES.map((locale) => {
      const label = new Intl.DisplayNames([locale], {
        type: "language",
      }).of(locale)

      return [locale, label ?? FALLBACK_LOCALE_LABELS[locale]]
    })
  ) as Record<Locale, string>
}

export const LOCALE_LABELS: Record<Locale, string> = createLocaleLabels()

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.includes(value as Locale)
}

export function normalizeLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE
}

export function getLocaleLabel(locale: Locale): string {
  return LOCALE_LABELS[locale]
}

export function stripPort(host: string | null | undefined): string | null {
  if (!host) {
    return null
  }

  return host.replace(/:\d+$/, "")
}

export function getPort(host: string | null | undefined): string | null {
  if (!host) {
    return null
  }

  const match = host.match(/:(\d+)$/)
  return match?.[1] ?? null
}

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

export function parseCookieLocale(cookieHeader: string | null | undefined): Locale | null {
  const value = readCookie(cookieHeader, LOCALE_COOKIE)
  return value ? normalizeLocale(value) : null
}

/** Reads the deliberate-choice cookie; null when unset or invalid. */
export function parseChoiceLocale(cookieHeader: string | null | undefined): Locale | null {
  const value = readCookie(cookieHeader, LOCALE_CHOICE_COOKIE)
  return isLocale(value) ? value : null
}

/** Cookie string for `document.cookie` recording a deliberate locale choice. */
export function serializeChoiceCookie(locale: Locale): string {
  return `${LOCALE_CHOICE_COOKIE}=${locale}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax`
}

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

export function getPreferredLocale(header: string | null | undefined): Locale {
  const candidates = parseAcceptLanguage(header)

  for (const candidate of candidates) {
    if (isLocale(candidate)) {
      return candidate
    }
  }

  return DEFAULT_LOCALE
}

export function resolveCookieLocale(options: {
  acceptLanguageHeader?: string | null
  cookieHeader?: string | null
}): { locale: Locale; source: LocaleSource } {
  const cookieLocale = parseCookieLocale(options.cookieHeader)
  if (cookieLocale) {
    return {
      locale: cookieLocale,
      source: "cookie",
    }
  }

  const acceptLanguageLocale = getPreferredLocale(options.acceptLanguageHeader)
  return {
    locale: acceptLanguageLocale,
    source: acceptLanguageLocale === DEFAULT_LOCALE ? "default" : "accept-language",
  }
}

export function resolveRouteLocale(options: {
  acceptLanguageHeader?: string | null
  routeLocale?: string | null
}): { locale: Locale; source: LocaleSource } {
  if (isLocale(options.routeLocale)) {
    return {
      locale: options.routeLocale,
      source: "route",
    }
  }

  const acceptLanguageLocale = getPreferredLocale(options.acceptLanguageHeader)
  return {
    locale: acceptLanguageLocale,
    source: acceptLanguageLocale === DEFAULT_LOCALE ? "default" : "accept-language",
  }
}

export function replaceLocaleInPath(pathname: string, locale: Locale): string {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`
  const segments = normalizedPathname.split("/").filter(Boolean)

  if (segments.length > 0 && isLocale(segments[0])) {
    segments[0] = locale
  } else {
    segments.unshift(locale)
  }

  return `/${segments.join("/")}`
}

export function extractLocaleFromPath(pathname: string): Locale | null {
  const firstSegment = pathname.split("/").filter(Boolean)[0]
  return isLocale(firstSegment) ? firstSegment : null
}

export function resolveHostLocale(
  requestHost: string | null | undefined,
  config: HostLocaleConfig
): Locale | null {
  const normalizedHost = stripPort(requestHost)
  if (!normalizedHost) {
    return null
  }

  for (const locale of LOCALES) {
    if (stripPort(config.locales[locale]) === normalizedHost) {
      return locale
    }
  }

  if (config.defaultHost && normalizedHost === stripPort(config.defaultHost)) {
    return DEFAULT_LOCALE
  }

  return null
}

export function getCanonicalHost(
  locale: Locale,
  config: HostLocaleConfig,
  fallbackHost?: string | null
): string | null {
  return config.locales[locale] ?? stripPort(fallbackHost) ?? config.defaultHost ?? null
}

export function buildCanonicalUrl(options: {
  hostConfig?: HostLocaleConfig
  locale: Locale
  pathname: string
  requestHost?: string | null
  search?: string | null
}) {
  const canonicalPath = replaceLocaleInPath(options.pathname, options.locale)
  const canonicalHost = options.hostConfig
    ? getCanonicalHost(options.locale, options.hostConfig, options.requestHost)
    : null
  const requestPort = getPort(options.requestHost)

  if (!canonicalHost) {
    return `${canonicalPath}${options.search ?? ""}`
  }

  const hostWithPort =
    requestPort && !canonicalHost.includes(":") ? `${canonicalHost}:${requestPort}` : canonicalHost

  return `http://${hostWithPort}${canonicalPath}${options.search ?? ""}`
}

export function createRouteLocaleBanner(options: {
  acceptLanguageHeader?: string | null
  choiceLocale?: Locale | null
  currentLocale: Locale
  hostConfig?: HostLocaleConfig
  pathname: string
  requestHost?: string | null
  search?: string | null
}): LocaleBanner | null {
  const hostLocale = options.hostConfig
    ? resolveHostLocale(options.requestHost, options.hostConfig)
    : null

  if (hostLocale && hostLocale !== options.currentLocale) {
    return {
      currentLocale: options.currentLocale,
      description: `This host is mapped to ${getLocaleLabel(hostLocale)} while the URL is rendering ${getLocaleLabel(options.currentLocale)}.`,
      reason: "host",
      recommendedLocale: hostLocale,
      recommendedUrl: buildCanonicalUrl({
        hostConfig: options.hostConfig,
        locale: hostLocale,
        pathname: options.pathname,
        requestHost: options.requestHost,
        search: options.search,
      }),
    }
  }

  // A deliberate earlier choice (switcher, CTA or dismiss — recorded in the
  // choice cookie) overrides the raw browser language. So an explicit decision
  // stops the suggestion, while an unintended landing (e.g. a bookmark to /en
  // by a German speaker) still gets informed exactly once. The host mismatch
  // above is unaffected — a wrong host for the locale is a real routing bug.
  const preferredLocale = options.choiceLocale ?? getPreferredLocale(options.acceptLanguageHeader)
  if (preferredLocale === options.currentLocale) {
    return null
  }

  return {
    currentLocale: options.currentLocale,
    description: `You prefer ${getLocaleLabel(preferredLocale)}, but this page is currently rendering ${getLocaleLabel(options.currentLocale)}.`,
    reason: "accept-language",
    recommendedLocale: preferredLocale,
    recommendedUrl: buildCanonicalUrl({
      hostConfig: options.hostConfig,
      locale: preferredLocale,
      pathname: options.pathname,
      requestHost: options.requestHost,
      search: options.search,
    }),
  }
}
