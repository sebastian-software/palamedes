import { createI18n } from "@palamedes/core/compiled";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { loadServerCatalog } from "virtual:palamedes/server-catalogs";
import { createI18n as createExampleI18n, type Locale, locales } from "./i18n";

export const serverI18nScope = createServerI18nScope<ReturnType<typeof createExampleI18n>>();

export async function createServerI18n(locale: Locale) {
  const i18n = createI18n();
  i18n.load(locale, await loadServerCatalog(locale));
  i18n.activate(locale);
  return i18n;
}

export async function activateServerI18n(locale: Locale) {
  return serverI18nScope.activate(await createServerI18n(locale));
}

export async function createRequestI18n(request: Request) {
  const { locale } = locales.resolve({
    strategy: "subdomain",
    acceptLanguageHeader: request.headers.get("accept-language"),
    requestHost: request.headers.get("host"),
  });
  return createServerI18n(locale);
}
