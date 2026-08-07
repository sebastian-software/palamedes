import { createI18n } from "@palamedes/core"
import type { CompiledCatalogMessages } from "@palamedes/core/compiled"
import { activateServerI18n as activateScopedServerI18n, setClientI18n } from "@palamedes/runtime"
import { defineLocaleControls } from "@palamedes/core/locale"
import { messages as enMessages } from "../locales/en.po"
import { messages as deMessages } from "../locales/de.po"
import { messages as esMessages } from "../locales/es.po"

export const LOCALES = ["en", "de", "es"] as const
export const DEFAULT_LOCALE = "en"
export const LOCALE_COOKIE = "locale"
export type Locale = (typeof LOCALES)[number]

declare global {
  interface Window {
    __PALAMEDES_LOCALE__?: string
  }
}

/** Headless locale controls for this demo (cookie strategy). */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
})

export const LOCALE_LABELS = locales.labels

// Demo catalogs are tiny, so they ship statically. That keeps client locale
// activation synchronous, which matters during hydration: translated components
// render in the same pass as the activation call, before any async load could
// resolve. Larger apps would dynamically import per-locale chunks instead.
const CATALOGS: Record<Locale, CompiledCatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
}

export function getLocaleLabel(locale: Locale) {
  return locales.label(locale)
}

export function loadMessages(locale: Locale): CompiledCatalogMessages {
  return CATALOGS[locale]
}

export function resolveCookieLocale(headers: Record<string, string | undefined>) {
  return locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: headers["accept-language"],
    cookieHeader: headers.cookie,
  })
}

const clientI18n = createI18n()

export async function createServerI18n(locale: Locale) {
  const i18n = createI18n()
  i18n.load(locale, loadMessages(locale))
  i18n.activate(locale)
  return i18n
}

export async function activateServerI18n(locale: Locale) {
  return activateScopedServerI18n(await createServerI18n(locale))
}

export function initializeClientI18n(locale: Locale) {
  clientI18n.load(locale, loadMessages(locale))
  clientI18n.activate(locale)

  if (typeof window !== "undefined") {
    setClientI18n(clientI18n)
  }
}

if (typeof window !== "undefined") {
  const locale = window.__PALAMEDES_LOCALE__
  if (!locales.isLocale(locale)) {
    throw new Error(
      `Expected an injected supported server locale, received ${JSON.stringify(locale)}`
    )
  }

  initializeClientI18n(locale)
}
