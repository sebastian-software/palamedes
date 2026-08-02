import type { CompiledCatalogMessages } from "@palamedes/core/compiled"
import { setServerI18nGetter } from "@palamedes/runtime"
import { messages as enMessages } from "../locales/en.po"
import { messages as deMessages } from "../locales/de.po"
import { messages as esMessages } from "../locales/es.po"
import { createExampleI18n, type Locale } from "./i18n"

// The server renders every route and locale, so it keeps the full catalogs.
// Bundle size is a client concern; the client receives its messages through
// generated sidecar modules instead (see lib/i18n.ts).
const CATALOGS: Record<Locale, CompiledCatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
}

export function activateServerI18n(locale: Locale) {
  const i18n = createExampleI18n()
  i18n.load(locale, CATALOGS[locale])
  i18n.activate(locale)
  setServerI18nGetter(() => i18n)
  return i18n
}
