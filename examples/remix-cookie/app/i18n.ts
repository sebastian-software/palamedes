import { createI18n, type PalamedesI18n } from "@palamedes/core"
import { createRemixI18nRequestScope } from "@palamedes/remix/server"

function resolveLocale(request: Request): "de" | "en" {
  return request.headers.get("accept-language")?.toLowerCase().startsWith("de") ? "de" : "en"
}

export const remixI18n = createRemixI18nRequestScope<PalamedesI18n>((request) => {
  const i18n = createI18n()
  i18n.activate(resolveLocale(request))
  return i18n
})
