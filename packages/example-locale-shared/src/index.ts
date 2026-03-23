export const DEFAULT_LOCALE = "en"
export const LOCALES = ["en", "de", "es"] as const
export const LOCALE_COOKIE = "locale"

export type Locale = (typeof LOCALES)[number]
export type LocaleSource = "accept-language" | "cookie" | "default" | "host" | "route"

export interface HostLocaleConfig {
  locales: Partial<Record<Locale, string>>
  defaultHost?: string | null
}

export interface LocaleBanner {
  currentLocale: Locale
  description: string
  reason: "accept-language" | "host"
  recommendedLocale: Locale
  recommendedUrl: string
}

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  de: "Deutsch",
  es: "Espanol",
}

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

export function parseCookieLocale(cookieHeader: string | null | undefined): Locale | null {
  if (!cookieHeader) {
    return null
  }

  for (const segment of cookieHeader.split(";")) {
    const [rawKey, rawValue] = segment.split("=")
    if (rawKey?.trim() !== LOCALE_COOKIE) {
      continue
    }

    return normalizeLocale(rawValue?.trim())
  }

  return null
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
    requestPort && !canonicalHost.includes(":")
      ? `${canonicalHost}:${requestPort}`
      : canonicalHost

  return `http://${hostWithPort}${canonicalPath}${options.search ?? ""}`
}

export function createRouteLocaleBanner(options: {
  acceptLanguageHeader?: string | null
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

  const preferredLocale = getPreferredLocale(options.acceptLanguageHeader)
  if (preferredLocale === options.currentLocale) {
    return null
  }

  return {
    currentLocale: options.currentLocale,
    description: `Your browser prefers ${getLocaleLabel(preferredLocale)}, but this page is currently rendering ${getLocaleLabel(options.currentLocale)}.`,
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
