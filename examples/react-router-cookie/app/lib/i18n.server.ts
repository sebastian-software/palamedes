import { readFileSync } from "node:fs"
import path from "node:path"
import type { CompiledCatalogMessages } from "@palamedes/core/compiled"
import { setServerI18nGetter } from "@palamedes/runtime"
import { messages as enMessages } from "../locales/en.po"
import { messages as deMessages } from "../locales/de.po"
import { messages as esMessages } from "../locales/es.po"
import { createExampleI18n, type Locale } from "./i18n"

// The server renders every route and locale, so it keeps the full catalogs.
// Bundle size is a client concern; the client receives its messages through
// generated sidecar modules instead (see lib/i18n.ts).
const CATALOGS: Record<Locale, CompiledCatalogMessages> = {
  en: enMessages,
  de: deMessages,
  es: esMessages,
}

export function activateServerI18n(locale: Locale) {
  const i18n = createExampleI18n()
  i18n.load(locale, CATALOGS[locale])
  i18n.activate(locale)
  setServerI18nGetter(() => i18n)
  return i18n
}

// Import-map locale binding: the production client resolves its per-route
// message assets through one import map per locale, emitted next to the
// client assets. The document must carry the active locale's map before any
// module loads, so the root loader reads it here. In dev the manifest does
// not exist (dev serves the embedded form) and this returns null.
const importMapCache = new Map<Locale, string | null>()

function readLocaleImportMap(locale: Locale): string | null {
  try {
    const clientDir = path.resolve(import.meta.dirname, "../client")
    const manifest = JSON.parse(
      readFileSync(path.join(clientDir, "palamedes-split-manifest.json"), "utf8")
    ) as { importMaps: Record<string, string> }
    const mapFile = manifest.importMaps[locale]
    return mapFile ? readFileSync(path.join(clientDir, mapFile), "utf8") : null
  } catch {
    return null
  }
}

export function getLocaleImportMap(locale: Locale): string | null {
  if (!importMapCache.has(locale)) {
    importMapCache.set(locale, readLocaleImportMap(locale))
  }
  return importMapCache.get(locale) ?? null
}
