import "server-only";

import { defineLocaleControls } from "@palamedes/core/locale";
import { createViteServerI18n } from "@palamedes/vite-plugin/server";

export type Locale = "en" | "de" | "fr";
const controls = defineLocaleControls<Locale>({
  locales: ["en", "de", "fr"],
  defaultLocale: "en",
  cookies: { locale: "locale" },
});

function resolveLocale(request: Request): Locale {
  return controls.resolve({
    strategy: "cookie",
    cookieHeader: request.headers.get("cookie"),
    acceptLanguageHeader: request.headers.get("accept-language"),
  }).locale;
}

/** Resolves request policy; the Vite adapter owns lazy catalog loading. */
export async function createRequestI18n(request: Request) {
  const locale = resolveLocale(request);
  return createViteServerI18n({ locale });
}
