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
// module loads, and can preload the mapped assets of the chunks it serves so
// messages download in parallel with the code. In dev the manifest does not
// exist (dev serves the embedded form) and this returns null.
export type LocaleBinding = {
  importMapJson: string
  imports: Record<string, string>
  chunkImports: Record<string, string[]>
}

const bindingCache = new Map<Locale, LocaleBinding | null>()

function readLocaleBinding(locale: Locale): LocaleBinding | null {
  try {
    const clientDir = path.resolve(import.meta.dirname, "../client")
    const manifest = JSON.parse(
      readFileSync(path.join(clientDir, "palamedes-split-manifest.json"), "utf8")
    ) as { importMaps: Record<string, string>; chunkImports?: Record<string, string[]> }
    const mapFile = manifest.importMaps[locale]
    if (!mapFile) {
      return null
    }
    const importMapJson = readFileSync(path.join(clientDir, mapFile), "utf8")
    const parsed = JSON.parse(importMapJson) as { imports: Record<string, string> }
    return {
      importMapJson,
      imports: parsed.imports,
      chunkImports: manifest.chunkImports ?? {},
    }
  } catch {
    return null
  }
}

export function getLocaleBinding(locale: Locale): LocaleBinding | null {
  if (!bindingCache.has(locale)) {
    bindingCache.set(locale, readLocaleBinding(locale))
  }
  return bindingCache.get(locale) ?? null
}
