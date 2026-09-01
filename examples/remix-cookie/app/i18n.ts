import path from "node:path"

import type { CatalogMessages } from "@palamedes/core"
import { defineLocaleControls, type LocaleSource } from "@palamedes/core/locale"
import { compileCatalogArtifact } from "@palamedes/core-node"
import { createRemixI18nServer } from "@palamedes/remix/server"

import { messages as deMessages } from "./locales/de.po"
import { messages as enMessages } from "./locales/en.po"
import { messages as esMessages } from "./locales/es.po"

export const LOCALES = ["en", "de", "es"] as const
export const DEFAULT_LOCALE = "en"
export const LOCALE_COOKIE = "locale"

export type Locale = (typeof LOCALES)[number]
export type ResolvedLocale = {
  locale: Locale
  source: LocaleSource
}

export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
})

export const LOCALE_LABELS = locales.labels
export const normalizeLocale = locales.normalizeLocale

const CATALOGS: Record<Locale, CatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
}

const CLIENT_CATALOGS = new Map<Locale, CatalogMessages>()
const EXAMPLE_ROOT = path.resolve(import.meta.dirname, "..")

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale)
}

export function loadMessages(locale: Locale): CatalogMessages {
  return CATALOGS[locale]
}

export function loadClientMessages(locale: Locale): CatalogMessages {
  const cached = CLIENT_CATALOGS.get(locale)
  if (cached) {
    return cached
  }

  const messages = compileCatalogArtifact(
    {
      rootDir: EXAMPLE_ROOT,
      locales: [...LOCALES],
      sourceLocale: DEFAULT_LOCALE,
      catalogs: [{ path: "app/locales/{locale}", include: ["app"] }],
    },
    path.join(EXAMPLE_ROOT, "app", "locales", `${locale}.po`)
  ).messages
  CLIENT_CATALOGS.set(locale, messages)
  return messages
}

export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "cookie",
  loadMessages,
  loadClientMessages,
  cookieName: LOCALE_COOKIE,
})

export function resolveLocaleFromRequest(request: Request): ResolvedLocale {
  return remixI18n.resolveLocale(request)
}

export function serializeLocaleCookie(locale: Locale): string {
  return remixI18n.serializeLocaleCookie(locale)
}
