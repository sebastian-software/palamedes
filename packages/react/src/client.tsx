import * as React from "react"
import { use, useMemo, type ReactNode } from "react"

import {
  createI18n,
  type CompiledCatalogMessages,
  type CompiledPalamedesI18n,
} from "@palamedes/core/compiled"
import { activateServerI18n, setClientI18n } from "@palamedes/runtime"

export type ClientCatalogModule = {
  messages: CompiledCatalogMessages
}

export type ClientCatalogBoundaryProps<TLocale extends string> = {
  children: ReactNode
  locale: TLocale
}

export type CreateClientCatalogBoundaryOptions<TLocale extends string> = {
  /**
   * Keep each locale behind its own dynamic import so the bundler can emit a
   * separate catalog chunk. The returned generated module is never serialized
   * through React Server Components.
   */
  loadCatalog: (locale: TLocale) => Promise<ClientCatalogModule>
  /**
   * Resolve the locale already selected for this browser document. This is
   * called once when the client module evaluates, before React hydrates.
   */
  resolveClientLocale: () => TLocale
}

function createCatalogI18n<TLocale extends string>(
  locale: TLocale,
  catalog: ClientCatalogModule
): CompiledPalamedesI18n {
  const i18n = createI18n()
  i18n.load(locale, catalog.messages)
  i18n.activate(locale)
  return i18n
}

/**
 * Create a catalog boundary for applications whose locale is fixed for the
 * lifetime of a browser document.
 *
 * The active locale starts loading when this client module evaluates. Before
 * the resource resolves, the boundary suspends; when it resolves, the shared
 * hook-free runtime is initialized before descendants can render or hydrate.
 * Locale changes must perform a document navigation.
 */
export function createClientCatalogBoundary<TLocale extends string>({
  loadCatalog,
  resolveClientLocale,
}: CreateClientCatalogBoundaryOptions<TLocale>) {
  const serverResources = new Map<TLocale, Promise<ClientCatalogModule>>()
  const clientLocale = typeof window === "undefined" ? undefined : resolveClientLocale()
  let clientI18nResource: Promise<CompiledPalamedesI18n> | undefined

  function createClientI18nResource(locale: TLocale): Promise<CompiledPalamedesI18n> {
    const resource = loadCatalog(locale).then((catalog) =>
      setClientI18n(createCatalogI18n(locale, catalog))
    )
    clientI18nResource = resource
    void resource.catch(() => {
      if (clientI18nResource === resource) {
        clientI18nResource = undefined
      }
    })
    return resource
  }

  if (clientLocale !== undefined) {
    createClientI18nResource(clientLocale)
  }

  function getClientI18nResource(): Promise<CompiledPalamedesI18n> {
    if (clientLocale === undefined) {
      throw new Error("Palamedes client catalog boundary was rendered on the server")
    }
    return clientI18nResource ?? createClientI18nResource(clientLocale)
  }

  function getServerCatalogResource(locale: TLocale): Promise<ClientCatalogModule> {
    let resource = serverResources.get(locale)
    if (!resource) {
      resource = loadCatalog(locale)
      serverResources.set(locale, resource)
      void resource.catch(() => {
        if (serverResources.get(locale) === resource) {
          serverResources.delete(locale)
        }
      })
    }
    return resource
  }

  function ClientCatalogBoundary({ children, locale }: ClientCatalogBoundaryProps<TLocale>) {
    const isClient = typeof window !== "undefined"
    if (isClient && locale !== clientLocale) {
      throw new Error(
        `Palamedes reload catalog boundary received locale "${locale}", but this document was initialized for "${clientLocale}". Perform a document navigation to change locale.`
      )
    }

    const resource = (
      isClient ? getClientI18nResource() : getServerCatalogResource(locale)
    ) as Promise<ClientCatalogModule | CompiledPalamedesI18n>
    const catalogOrI18n = use(resource)
    const i18n = useMemo<CompiledPalamedesI18n>(() => {
      if (isClient) {
        return catalogOrI18n as CompiledPalamedesI18n
      }
      return createCatalogI18n(locale, catalogOrI18n as ClientCatalogModule)
    }, [catalogOrI18n, isClient, locale])

    if (!isClient) {
      activateServerI18n(i18n)
    }

    return children
  }

  ClientCatalogBoundary.displayName = "PalamedesClientCatalogBoundary"
  return ClientCatalogBoundary
}
