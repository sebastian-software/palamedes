import { defineLocaleControls } from "@palamedes/core/locale";
const controls = defineLocaleControls({
  locales: ["en", "de", "fr"] as const,
  defaultLocale: "en",
  cookies: { locale: "locale" },
});
export function resolveLocale(request: Request) {
  return controls.resolve({
    strategy: "cookie",
    cookieHeader: request.headers.get("cookie"),
    acceptLanguageHeader: request.headers.get("accept-language"),
  }).locale;
}
