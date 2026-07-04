import type { CatalogMessages } from "@palamedes/core"
import { setClientI18n, setServerI18nGetter } from "@palamedes/runtime"
import { createExampleI18n, type Locale } from "./i18n"
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

export function syncClientI18n(locale: Locale) {
  clientI18n.load(locale, CATALOGS[locale])
  clientI18n.activate(locale)

  if (typeof window === "undefined") {
    // During SSR the client components still render on the server, so they
    // resolve translations through the server scope. Point it at this
    // synchronously-populated instance.
    setServerI18nGetter(() => clientI18n)
  } else {
    // At hydration the catalog is already loaded synchronously above, so the
    // client i18n is active in the same render pass — no async gap that would
    // throw "No active client i18n instance".
    setClientI18n(clientI18n)
  }
}
