// The compatibility factory, deliberately: the demo panels format raw ICU
// patterns at runtime through the plain `Trans` component, which needs the
// parser. Apps without raw-ICU usage can import createI18n from
// "@palamedes/core/compiled" instead and drop the parser from the bundle;
// the generated message sidecars work identically with both factories.
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"
import { defineLocaleControls } from "@palamedes/core/locale"

export const LOCALES = ["en", "de", "es"] as const
export const DEFAULT_LOCALE = "en"
export const LOCALE_COOKIE = "locale"
export type Locale = (typeof LOCALES)[number]

/** Headless locale controls for this demo (cookie strategy). */
export const locales = defineLocaleControls<Locale>({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  cookies: { locale: LOCALE_COOKIE },
})

export const LOCALE_LABELS = locales.labels

export function getLocaleLabel(locale: Locale): string {
  return locales.label(locale)
}

export function createExampleI18n() {
  return createI18n()
}

// This example uses experimental graph splitting: no catalog is imported here.
// Every code chunk registers the messages it uses through a generated sidecar
// module at evaluation time, so activation stays synchronous and
// hydration-safe, and `setClientI18n` flushes registrations that arrived
// before the instance was installed. Server rendering keeps its full catalogs
// in lib/i18n.server.ts.
const clientI18n = createExampleI18n()

export function initializeClientI18n(locale: Locale) {
  if (typeof document === "undefined") {
    return
  }

  clientI18n.activate(locale)
  setClientI18n(clientI18n)
}

export function resolveLocaleFromRequest(request: Request) {
  return locales.resolve({
    strategy: "cookie",
    acceptLanguageHeader: request.headers.get("accept-language"),
    cookieHeader: request.headers.get("cookie"),
  })
}
