import type { CatalogMessages } from "@palamedes/core"
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_LABELS,
  type Locale,
} from "@palamedes/example-locale-shared"

export { DEFAULT_LOCALE, LOCALES, LOCALE_COOKIE, LOCALE_LABELS, type Locale }

export async function loadMessages(locale: Locale): Promise<CatalogMessages> {
  const { messages } = await import(`../locales/${locale}.po`)
  return messages
}

const clientI18n = createI18n()

export function createExampleI18n() {
  return createI18n()
}

export function normalizeLocale(value: unknown): Locale {
  return typeof value === "string" && LOCALES.includes(value as Locale)
    ? (value as Locale)
    : DEFAULT_LOCALE
}

export function getLocaleLabel(locale: Locale): string {
  return LOCALE_LABELS[locale]
}

export async function syncClientI18n(locale: Locale) {
  if (typeof window === "undefined") {
    return
  }

  const messages = await loadMessages(locale)
  clientI18n.load(locale, messages)
  clientI18n.activate(locale)
  setClientI18n(clientI18n)
}

function bootstrapClientI18n() {
  if (typeof window === "undefined") {
    return
  }

  const cookieValue = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(`${LOCALE_COOKIE}=`.length)

  const preferredLanguage = navigator.language.split("-")[0] ?? DEFAULT_LOCALE
  void syncClientI18n(normalizeLocale(cookieValue ?? preferredLanguage))
}

bootstrapClientI18n()
