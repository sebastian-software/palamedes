import "server-only";

import { createViteServerI18n } from "@palamedes/vite-plugin/server";

export type Locale = "en" | "de";

function resolveLocale(request: Request): Locale {
  const cookie = request.headers.get("cookie") ?? "";
  if (/(?:^|;\s*)locale=de(?:;|$)/u.test(cookie)) {
    return "de";
  }
  return request.headers.get("accept-language")?.startsWith("de") ? "de" : "en";
}

/** Resolves request policy; the Vite adapter owns lazy catalog loading. */
export async function createRequestI18n(request: Request) {
  const locale = resolveLocale(request);
  return createViteServerI18n({ locale });
}
