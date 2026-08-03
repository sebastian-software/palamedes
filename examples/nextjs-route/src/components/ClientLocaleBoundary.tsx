"use client"

import { createClientCatalogBoundary } from "@palamedes/react/client"

import type { Locale } from "@/lib/i18n"

export const ClientLocaleBoundary = createClientCatalogBoundary<Locale>({
  // Turbopack turns this statically analyzable import context into one catalog
  // chunk per locale. Only the requested locale is loaded for hydration.
  loadCatalog: (locale) => import(`../locales/${locale}.po`),
})
