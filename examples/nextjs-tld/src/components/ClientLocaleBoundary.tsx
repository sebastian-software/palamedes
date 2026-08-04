"use client"

import { createClientCatalogBoundary } from "@palamedes/react/client"

import { locales, type Locale } from "@/lib/i18n"

export const ClientLocaleBoundary = createClientCatalogBoundary<Locale>({
  loadCatalog: (locale) => import(`../locales/${locale}.po`),
  resolveClientLocale() {
    const locale = document.documentElement.lang
    if (!locales.isLocale(locale)) {
      throw new Error(`Unsupported document locale: ${locale}`)
    }
    return locale
  },
})
