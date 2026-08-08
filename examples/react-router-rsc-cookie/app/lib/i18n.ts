import "server-only"

import { createI18n } from "@palamedes/core"
import { messages as deMessages } from "../locales/de.po"
import { messages as enMessages } from "../locales/en.po"

export type Locale = "en" | "de"

function resolveLocale(request: Request): Locale {
  const cookie = request.headers.get("cookie") ?? ""
  if (/(?:^|;\s*)locale=de(?:;|$)/u.test(cookie)) {
    return "de"
  }
  return request.headers.get("accept-language")?.startsWith("de") ? "de" : "en"
}

/** Receives the original RSC Request from the custom entry, including cookies. */
export function createRequestI18n(request: Request) {
  const locale = resolveLocale(request)
  const i18n = createI18n()
  i18n.load(locale, locale === "de" ? deMessages : enMessages)
  i18n.activate(locale)
  return i18n
}
