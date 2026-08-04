"use client"

import { createReloadClientCatalogBoundary } from "@palamedes/react/client"

import { locales, type Locale } from "@/lib/i18n"

export const ClientLocaleBoundary = createReloadClientCatalogBoundary<Locale>({
  // Turbopack turns this statically analyzable import context into one catalog
  // chunk per locale. Only the requested locale is loaded for hydration.
  loadCatalog: (locale) => import(`../locales/${locale}.po`),
  resolveClientLocale() {
    const locale = document.documentElement.lang
    if (!locales.isLocale(locale)) {
      throw new Error(`Unsupported document locale: ${locale}`)
    }
    return locale
  },
})
