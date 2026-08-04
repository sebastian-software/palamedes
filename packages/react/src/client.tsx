import * as React from "react"
import { use, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react"

import {
  createI18n,
  type CompiledCatalogMessages,
  type CompiledPalamedesI18n,
} from "@palamedes/core/compiled"
import { activateServerI18n, getClientI18nSnapshot, setClientI18n } from "@palamedes/runtime"

import {
  getReactiveI18nSnapshot,
  getServerI18nSnapshot,
  subscribeReactiveI18n,
} from "./clientStore"
import { ClientI18nScope } from "./clientScope"

export type ClientCatalogModule = {
  messages: CompiledCatalogMessages
}

export type ClientCatalogRevision = number | string

export type ClientCatalogBoundaryProps<TLocale extends string> = {
  children: ReactNode
  locale: TLocale
  /**
   * Change this serializable value to load and commit refreshed contents for
   * the same locale. It may be a build ID, content hash, or application data
   * revision.
   */
  catalogRevision?: ClientCatalogRevision
}

export type ReloadClientCatalogBoundaryProps<TLocale extends string> = {
  children: ReactNode
  locale: TLocale
}

export type CreateClientCatalogBoundaryOptions<TLocale extends string> = {
  /**
   * Keep each locale behind its own dynamic import so the bundler can emit a
   * separate catalog chunk. The returned generated module is never serialized
   * through React Server Components.
   */
  loadCatalog: (
    locale: TLocale,
    catalogRevision: ClientCatalogRevision | undefined
  ) => Promise<ClientCatalogModule>
}

export type CreateReloadClientCatalogBoundaryOptions<TLocale extends string> =
  CreateClientCatalogBoundaryOptions<TLocale> & {
    /**
     * Resolve the locale already selected for this browser document. This is
     * called once when the client module evaluates, before React hydrates.
     */
    resolveClientLocale: () => TLocale
  }

const DEFAULT_CATALOG_REVISION = Symbol("palamedes.defaultCatalogRevision")

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
 * Create a render-safe client catalog boundary for generated catalogs.
 *
 * The boundary suspends until the requested catalog module is available,
 * creates a boundary-local parser-free i18n instance, and publishes that
 * instance to the shared client runtime only after React commits the render.
 */
export function createClientCatalogBoundary<TLocale extends string>({
  loadCatalog,
}: CreateClientCatalogBoundaryOptions<TLocale>) {
  type ResourceKey = ClientCatalogRevision | typeof DEFAULT_CATALOG_REVISION
  const resources = new Map<TLocale, Map<ResourceKey, Promise<ClientCatalogModule>>>()

  function getCatalogResource(
    locale: TLocale,
    catalogRevision: ClientCatalogRevision | undefined
  ): Promise<ClientCatalogModule> {
    let localeResources = resources.get(locale)
    if (!localeResources) {
      localeResources = new Map()
      resources.set(locale, localeResources)
    }

    const resourceKey = catalogRevision ?? DEFAULT_CATALOG_REVISION
    let resource = localeResources.get(resourceKey)
    if (!resource) {
      resource = loadCatalog(locale, catalogRevision)
      localeResources.set(resourceKey, resource)
    }
    return resource
  }

  function ClientCatalogBoundary({
    catalogRevision,
    children,
    locale,
  }: ClientCatalogBoundaryProps<TLocale>) {
    const catalog = use(getCatalogResource(locale, catalogRevision))
    const i18n = useMemo<CompiledPalamedesI18n>(() => {
      // A revision must replace the scoped instance even when an HMR-aware or
      // application loader resolves to a module object with stable identity.
      void catalogRevision
      return createCatalogI18n(locale, catalog)
    }, [catalog, catalogRevision, locale])

    if (typeof window === "undefined") {
      // Client Component SSR resolves transformed getI18n() calls through the
      // framework-neutral runtime rather than React context. Enter the server
      // scope configured by the RSC entry; AsyncLocalStorage keeps this
      // activation request-local even when requests render concurrently.
      activateServerI18n(i18n)
    }

    useEffect(() => {
      // The scope already serves translated descendants during render. This
      // bridge is for code outside the scope and existing external-store
      // consumers, and must never run for a speculative/discarded tree.
      if (getClientI18nSnapshot().i18n !== i18n) {
        setClientI18n(i18n)
      }
    }, [i18n])

    return <ClientI18nScope i18n={i18n}>{children}</ClientI18nScope>
  }

  ClientCatalogBoundary.displayName = "PalamedesClientCatalogBoundary"
  return ClientCatalogBoundary
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
export function createReloadClientCatalogBoundary<TLocale extends string>({
  loadCatalog,
  resolveClientLocale,
}: CreateReloadClientCatalogBoundaryOptions<TLocale>) {
  const serverResources = new Map<TLocale, Promise<ClientCatalogModule>>()
  const clientLocale = typeof window === "undefined" ? undefined : resolveClientLocale()
  const clientI18nResource =
    clientLocale === undefined
      ? undefined
      : loadCatalog(clientLocale, undefined).then((catalog) =>
          setClientI18n(createCatalogI18n(clientLocale, catalog))
        )

  function getServerCatalogResource(locale: TLocale): Promise<ClientCatalogModule> {
    let resource = serverResources.get(locale)
    if (!resource) {
      resource = loadCatalog(locale, undefined)
      serverResources.set(locale, resource)
    }
    return resource
  }

  function ReloadClientCatalogBoundary({
    children,
    locale,
  }: ReloadClientCatalogBoundaryProps<TLocale>) {
    const isClient = typeof window !== "undefined"
    if (isClient && locale !== clientLocale) {
      throw new Error(
        `Palamedes reload catalog boundary received locale "${locale}", but this document was initialized for "${clientLocale}". Perform a document navigation to change locale.`
      )
    }

    const resource = (isClient ? clientI18nResource! : getServerCatalogResource(locale)) as Promise<
      ClientCatalogModule | CompiledPalamedesI18n
    >
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

  ReloadClientCatalogBoundary.displayName = "PalamedesReloadClientCatalogBoundary"
  return ReloadClientCatalogBoundary
}

export function useClientLocale<TLocale>(
  locale: TLocale,
  sync: (locale: TLocale) => unknown
): void {
  useSyncExternalStore(subscribeReactiveI18n, getReactiveI18nSnapshot, getServerI18nSnapshot)

  useEffect(() => {
    void sync(locale)
  }, [locale, sync])
}
