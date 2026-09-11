import path from "node:path";
import type { CompiledCatalogMessages } from "@palamedes/core/compiled";
import { createServerI18nScope } from "@palamedes/runtime/server";
import { createReactRouterCatalogDelivery } from "@palamedes/vite-plugin/react-router";
import { messages as enMessages } from "../locales/en.po";
import { messages as deMessages } from "../locales/de.po";
import { messages as esMessages } from "../locales/es.po";
import { createExampleI18n, type Locale } from "./i18n";

// The server renders every route and locale, so it keeps the full catalogs.
// Bundle size is a client concern; the client receives its messages through
// generated sidecar modules instead (see lib/i18n.ts).
const CATALOGS: Record<Locale, CompiledCatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
};

export const serverI18nScope = createServerI18nScope<ReturnType<typeof createExampleI18n>>();

export const catalogDelivery = createReactRouterCatalogDelivery({
  clientDirectory: path.resolve(process.cwd(), "build/client"),
  development: process.env.NODE_ENV !== "production",
});

export function createServerI18n(locale: Locale) {
  const i18n = createExampleI18n();
  i18n.load(locale, CATALOGS[locale]);
  i18n.activate(locale);
  return i18n;
}

export function activateServerI18n(locale: Locale) {
  return serverI18nScope.activate(createServerI18n(locale));
}

// Import-map locale binding: the production client resolves its per-route
// message assets through one import map per locale, emitted next to the
// client assets. The document must carry the active locale's map before any
// module loads, and can preload the mapped assets of the chunks it serves so
// messages download in parallel with the code. In dev the manifest does not
// exist (dev serves the embedded form) and this returns null.
export const getLocaleBinding = (locale: Locale) => catalogDelivery.getLocaleBinding(locale);
