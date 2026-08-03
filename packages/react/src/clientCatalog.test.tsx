// @vitest-environment jsdom
import { startTransition, useState } from "react"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"
import { act, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { defineCompiledCatalog } from "@palamedes/core/compiled"
import { getClientI18nSnapshot, resetI18nRuntime, subscribeClientI18n } from "@palamedes/runtime"

import { createClientCatalogBoundary } from "./client"
import { Trans } from "./compiled"
import { getI18n } from "./runtime"

type Locale = "de" | "en"

type CatalogModule = {
  messages: ReturnType<typeof defineCompiledCatalog>
}

function catalog(greeting: string): CatalogModule {
  return {
    messages: defineCompiledCatalog({ greeting }),
  }
}

function fulfilled<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value) as Promise<T> & {
    status: "fulfilled"
    value: T
  }
  promise.status = "fulfilled"
  promise.value = value
  return promise
}

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function Greeting() {
  return <span>{String(getI18n()._("greeting"))}</span>
}

describe("createClientCatalogBoundary", () => {
  afterEach(() => {
    resetI18nRuntime()
  })

  it("provides the active catalog on the first hydration render without a global bootstrap", async () => {
    const de = catalog("Hallo")
    const ServerBoundary = createClientCatalogBoundary<Locale>({
      loadCatalog: () => fulfilled(de),
    })
    const serverHtml = renderToString(
      <ServerBoundary locale="de">
        <Greeting />
      </ServerBoundary>
    )
    expect(serverHtml).toBe("<span>Hallo</span>")

    resetI18nRuntime()
    const clientCatalog = deferred<CatalogModule>()
    const ClientBoundary = createClientCatalogBoundary<Locale>({
      loadCatalog: () => clientCatalog.promise,
    })
    const container = document.createElement("div")
    container.innerHTML = serverHtml
    const firstHydrationLocales: string[] = []
    const recoverableErrors: unknown[] = []

    function HydrationGreeting() {
      const i18n = getI18n()
      firstHydrationLocales.push(i18n.locale)
      return <span>{String(i18n._("greeting"))}</span>
    }

    const root = hydrateRoot(
      container,
      <ClientBoundary locale="de">
        <HydrationGreeting />
      </ClientBoundary>,
      { onRecoverableError: (error) => recoverableErrors.push(error) }
    )

    expect(container.textContent).toBe("Hallo")
    expect(firstHydrationLocales).toStrictEqual([])

    await act(async () => {
      clientCatalog.resolve(de)
      await clientCatalog.promise
    })

    expect(firstHydrationLocales[0]).toBe("de")
    expect(container.textContent).toBe("Hallo")
    expect(recoverableErrors).toStrictEqual([])

    await act(async () => root.unmount())
  })

  it("publishes a committed locale navigation and renders its scoped catalog", () => {
    const Boundary = createClientCatalogBoundary<Locale>({
      loadCatalog: (locale) => fulfilled(locale === "de" ? catalog("Hallo") : catalog("Hello")),
    })

    function App({ locale }: { locale: Locale }) {
      return (
        <Boundary locale={locale}>
          <Trans id="greeting" components={{}} />
        </Boundary>
      )
    }

    const view = render(<App locale="en" />)
    expect(view.container.textContent).toBe("Hello")
    expect(getClientI18nSnapshot().i18n?.locale).toBe("en")

    view.rerender(<App locale="de" />)

    expect(view.container.textContent).toBe("Hallo")
    expect(getClientI18nSnapshot().i18n?.locale).toBe("de")
  })

  it("does not publish a discarded concurrent locale render", async () => {
    const de = deferred<CatalogModule>()
    const Boundary = createClientCatalogBoundary<Locale>({
      loadCatalog: (locale) => (locale === "de" ? de.promise : fulfilled(catalog("Hello"))),
    })
    let updateLocale!: (locale: Locale) => void

    function App() {
      const [locale, setLocale] = useState<Locale>("en")
      updateLocale = setLocale
      return (
        <Boundary locale={locale}>
          <Trans id="greeting" components={{}} />
        </Boundary>
      )
    }

    const view = render(<App />)
    const published: string[] = []
    const unsubscribe = subscribeClientI18n((i18n) => published.push(i18n.locale))

    act(() => {
      startTransition(() => updateLocale("de"))
    })

    expect(view.container.textContent).toBe("Hello")
    expect(getClientI18nSnapshot().i18n?.locale).toBe("en")
    expect(published).toStrictEqual([])

    act(() => updateLocale("en"))
    await act(async () => {
      de.resolve(catalog("Hallo"))
      await de.promise
    })

    expect(view.container.textContent).toBe("Hello")
    expect(getClientI18nSnapshot().i18n?.locale).toBe("en")
    expect(published).toStrictEqual([])
    unsubscribe()
  })

  it("refreshes catalog contents for the same locale and republishes the commit", () => {
    const catalogs = [catalog("Hello"), catalog("Welcome back")]
    let loadCount = 0
    const loadCatalog = vi.fn(() => fulfilled(catalogs[loadCount++] ?? catalogs[1]!))
    const Boundary = createClientCatalogBoundary<Locale>({
      loadCatalog,
    })

    function App({ catalogRevision }: { catalogRevision: string }) {
      return (
        <Boundary locale="en" catalogRevision={catalogRevision}>
          <Trans id="greeting" components={{}} />
        </Boundary>
      )
    }

    const view = render(<App catalogRevision="first" />)
    const firstSnapshot = getClientI18nSnapshot()
    const published: string[] = []
    const unsubscribe = subscribeClientI18n((i18n) => published.push(i18n.locale))

    view.rerender(<App catalogRevision="second" />)

    expect(view.container.textContent).toBe("Welcome back")
    expect(getClientI18nSnapshot().i18n?.locale).toBe("en")
    expect(getClientI18nSnapshot().revision).toBe(firstSnapshot.revision + 1)
    expect(published).toStrictEqual(["en"])
    expect(loadCatalog.mock.calls).toStrictEqual([
      ["en", "first"],
      ["en", "second"],
    ])
    unsubscribe()
  })

  it("loads only the locale requested by the rendered boundary", () => {
    const loadCatalog = vi.fn((locale: Locale) => fulfilled(catalog(locale)))
    const Boundary = createClientCatalogBoundary<Locale>({ loadCatalog })

    render(
      <Boundary locale="en">
        <Trans id="greeting" components={{}} />
      </Boundary>
    )

    expect(loadCatalog).toHaveBeenCalledOnce()
    expect(loadCatalog).toHaveBeenCalledWith("en", undefined)
  })
})
