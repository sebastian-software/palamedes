import { createI18n } from "@palamedes/core"
import type { CatalogMessages } from "@palamedes/core"
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_LABELS,
  type HostLocaleConfig,
  type Locale,
} from "@palamedes/example-locale-shared"

export {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_LABELS,
  type Locale,
}

export const ROUTE_HOSTS: HostLocaleConfig = {
  locales: {
    en: "en.lvh.me",
    de: "de.lvh.me",
    es: "es.lvh.me",
  },
}

/**
 * Load messages for a locale (used on both server and client)
 */
export async function loadMessages(locale: Locale): Promise<CatalogMessages> {
  const { messages } = await import(`../locales/${locale}.po`)
  return messages
}

export function createExampleI18n() {
  return createI18n()
}

export function getLocaleLabel(locale: Locale): string {
  return LOCALE_LABELS[locale]
}
