import { createI18n } from "@palamedes/core"
import type { CatalogMessages } from "@palamedes/core"
import { setClientI18n, setServerI18nGetter } from "@palamedes/runtime"
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_LABELS,
  type Locale,
} from "@palamedes/example-locale-shared"
import { messages as enMessages } from "../locales/en.po"
import { messages as deMessages } from "../locales/de.po"
import { messages as esMessages } from "../locales/es.po"

export { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, LOCALE_LABELS, type Locale }

// Demo catalogs are tiny, so they ship statically. That keeps client locale
// activation synchronous, which matters during hydration: translated components
// render in the same pass as the activation call, before any async load could
// resolve. Larger apps would dynamically import per-locale chunks instead.
const CATALOGS: Record<Locale, CatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
}

export function getLocaleLabel(locale: Locale) {
  return LOCALE_LABELS[locale]
}

export function loadMessages(locale: Locale): CatalogMessages {
  return CATALOGS[locale]
}

const clientI18n = createI18n()

export async function activateServerI18n(locale: Locale) {
  const i18n = createI18n()
  i18n.load(locale, loadMessages(locale))
  i18n.activate(locale)
  setServerI18nGetter(() => i18n)
  return i18n
}

export function syncClientI18n(locale: Locale) {
  clientI18n.load(locale, loadMessages(locale))
  clientI18n.activate(locale)

  if (typeof window === "undefined") {
    // "use client" components are still server-rendered for the initial HTML.
    // That SSR pass runs in its own module instance where activateServerI18n was
    // never called, so register this catalog as the server getter too — otherwise
    // their <Trans> calls throw "No active server i18n instance" during SSR.
    setServerI18nGetter(() => clientI18n)
    return
  }

  setClientI18n(clientI18n)
}
