import type { CatalogMessages } from "@palamedes/core"
import { activateServerI18n, setClientI18n } from "@palamedes/runtime"
import { createExampleI18n, locales, type Locale } from "./i18n"
import { messages as enMessages } from "../locales/en.po"
import { messages as deMessages } from "../locales/de.po"
import { messages as esMessages } from "../locales/es.po"
import { messages as frMessages } from "../locales/fr.po"

// Demo catalogs are tiny, so they ship statically. That keeps client locale
// activation synchronous, which matters during hydration: translated client
// components render in the same pass as the activation call, before any async
// import could resolve. Without this, hydration throws "No active client i18n
// instance". Larger apps would dynamically import per-locale chunks instead.
const CATALOGS: Record<Locale, CatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
  fr: frMessages,
}

const clientI18n = createExampleI18n()

export function activateServerClientI18n(locale: Locale) {
  const i18n = createExampleI18n()
  i18n.load(locale, CATALOGS[locale])
  i18n.activate(locale)
  activateServerI18n(i18n)
}

export function syncClientI18n(locale: Locale) {
  if (typeof window === "undefined") {
    return
  }

  clientI18n.load(locale, CATALOGS[locale])
  clientI18n.activate(locale)
  setClientI18n(clientI18n)
}

declare global {
  interface Window {
    __PALAMEDES_LOCALE__?: string
  }
}

if (typeof window !== "undefined" && locales.isLocale(window.__PALAMEDES_LOCALE__)) {
  syncClientI18n(window.__PALAMEDES_LOCALE__)
}
