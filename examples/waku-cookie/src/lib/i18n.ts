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

export { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, LOCALE_LABELS, type Locale }

export function getLocaleLabel(locale: Locale) {
  return LOCALE_LABELS[locale]
}

export async function loadMessages(locale: Locale): Promise<CatalogMessages> {
  const { messages } = await import(`../locales/${locale}.po`)
  return messages
}

const clientI18n = createI18n()

export async function activateServerI18n(locale: Locale) {
  const messages = await loadMessages(locale)
  const i18n = createI18n()
  i18n.load(locale, messages)
  i18n.activate(locale)
  setServerI18nGetter(() => i18n)
  return i18n
}

export async function syncClientI18n(locale: Locale) {
  const messages = await loadMessages(locale)
  clientI18n.load(locale, messages)
  clientI18n.activate(locale)

  if (typeof window === "undefined") {
    setServerI18nGetter(() => clientI18n)
  } else {
    setClientI18n(clientI18n)
  }

  return clientI18n
}
