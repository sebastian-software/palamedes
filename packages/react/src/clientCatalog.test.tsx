// @vitest-environment jsdom
import { Component, Suspense, type ReactNode } from "react"
import { act, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { defineCompiledCatalog } from "@palamedes/core/compiled"
import { getI18n, resetI18nRuntime } from "@palamedes/runtime"

import { createClientCatalogBoundary } from "./client"
import { Plural, Select, SelectOrdinal, Trans } from "./index"

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
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

class CatalogErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  public state: { error: Error | null } = { error: null }

  public static getDerivedStateFromError(error: Error) {
    return { error }
  }

  public render() {
    return this.state.error ? (
      <span role="alert">{this.state.error.message}</span>
    ) : (
      this.props.children
    )
  }
}

describe("createClientCatalogBoundary", () => {
  afterEach(() => {
    resetI18nRuntime()
    document.documentElement.lang = ""
  })

  it("initializes the hook-free getter once before translated descendants render", async () => {
    document.documentElement.lang = "de"
    const de = deferred<CatalogModule>()
    const loadCatalog = vi.fn(() => de.promise)
    const resolveClientLocale = vi.fn(() => document.documentElement.lang as Locale)
    const Boundary = createClientCatalogBoundary<Locale>({ loadCatalog, resolveClientLocale })
    const renderedLocales: string[] = []

    function Greeting() {
      const i18n = getI18n()
      renderedLocales.push(i18n.locale)
      return <span>{String(i18n._("greeting"))}</span>
    }

    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(
        <Suspense fallback={<span>Loading</span>}>
          <Boundary locale="de">
            <Greeting />
          </Boundary>
        </Suspense>
      )
    })

    expect(view.container.textContent).toBe("Loading")
    expect(renderedLocales).toStrictEqual([])
    expect(resolveClientLocale).toHaveBeenCalledOnce()
    expect(loadCatalog).toHaveBeenCalledOnce()
    expect(loadCatalog).toHaveBeenCalledWith("de")

    await act(async () => {
      de.resolve(catalog("Hallo"))
      await de.promise
    })

    await waitFor(() => expect(view.container.textContent).toBe("Hallo"))
    expect(renderedLocales).toStrictEqual(["de"])

    view.rerender(
      <Suspense fallback={<span>Loading</span>}>
        <Boundary locale="de">
          <Greeting />
        </Boundary>
      </Suspense>
    )

    expect(resolveClientLocale).toHaveBeenCalledOnce()
    expect(loadCatalog).toHaveBeenCalledOnce()
  })

  it("formats compat ICU fallbacks after initializing a parser-free client catalog", async () => {
    document.documentElement.lang = "en"
    const Boundary = createClientCatalogBoundary<Locale>({
      loadCatalog: () => fulfilled({ messages: defineCompiledCatalog({}) }),
      resolveClientLocale: () => document.documentElement.lang as Locale,
    })
    const when = new Date(Date.UTC(2026, 4, 8, 12, 0, 0))

    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(
        <Suspense fallback={<span>Loading</span>}>
          <Boundary locale="en">
            <>
              <Trans id="greeting" message="Hello {name}" values={{ name: "Ada" }} />
              <Trans id="date" message="{when, date, full}" values={{ when }} />
              <Plural value={3} one="# item" other="# items" />
              <Select value="female" female="She" other="They" />
              <SelectOrdinal value={3} one="#st" two="#nd" few="#rd" other="#th" />
            </>
          </Boundary>
        </Suspense>
      )
    })

    await waitFor(() =>
      expect(view.container.textContent).toBe(
        `Hello Ada${new Intl.DateTimeFormat("en", { dateStyle: "full" }).format(when)}3 itemsShe3rd`
      )
    )
  })

  it("fails fast when a render tries to change the document locale", async () => {
    document.documentElement.lang = "en"
    const Boundary = createClientCatalogBoundary<Locale>({
      loadCatalog: () => fulfilled(catalog("Hello")),
      resolveClientLocale: () => document.documentElement.lang as Locale,
    })

    await expect(
      act(async () => {
        render(
          <Boundary locale="de">
            <span>Mismatch</span>
          </Boundary>
        )
      })
    ).rejects.toThrow(/Perform a document navigation to change locale/)
  })

  it("retries a rejected preload and keeps the successful catalog cached", async () => {
    document.documentElement.lang = "de"
    const loadError = new Error("catalog unavailable")
    const loadCatalog = vi
      .fn<() => Promise<CatalogModule>>()
      .mockRejectedValueOnce(loadError)
      .mockResolvedValueOnce(catalog("Hallo"))
    const Boundary = createClientCatalogBoundary<Locale>({
      loadCatalog,
      resolveClientLocale: () => document.documentElement.lang as Locale,
    })
    expect(loadCatalog).toHaveBeenCalledOnce()

    function Greeting() {
      return <span>{String(getI18n()._("greeting"))}</span>
    }

    function boundary(retryKey: string) {
      return (
        <Suspense fallback={<span>Loading</span>}>
          <CatalogErrorBoundary key={retryKey}>
            <Boundary locale="de">
              <Greeting />
            </Boundary>
          </CatalogErrorBoundary>
        </Suspense>
      )
    }

    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(boundary("first"))
      await Promise.resolve()
    })
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("catalog unavailable"))
    expect(loadCatalog).toHaveBeenCalledOnce()

    await act(async () => {
      view.rerender(boundary("retry"))
      await Promise.resolve()
    })
    await waitFor(() => expect(view.container.textContent).toBe("Hallo"))
    expect(loadCatalog).toHaveBeenCalledTimes(2)
  })

  it("surfaces repeated rejected preloads before retrying successfully", async () => {
    document.documentElement.lang = "de"
    const firstError = new Error("first failure")
    const secondError = new Error("second failure")
    const preload = deferred<CatalogModule>()
    const loadCatalog = vi
      .fn<() => Promise<CatalogModule>>()
      .mockReturnValueOnce(preload.promise)
      .mockRejectedValueOnce(secondError)
      .mockResolvedValueOnce(catalog("Hallo"))
    const Boundary = createClientCatalogBoundary<Locale>({
      loadCatalog,
      resolveClientLocale: () => document.documentElement.lang as Locale,
    })
    expect(loadCatalog).toHaveBeenCalledOnce()

    await act(async () => {
      preload.reject(firstError)
      await Promise.resolve()
      await Promise.resolve()
    })

    function boundary(retryKey: string) {
      return (
        <Suspense fallback={<span>Loading</span>}>
          <CatalogErrorBoundary key={retryKey}>
            <Boundary locale="de">Ready</Boundary>
          </CatalogErrorBoundary>
        </Suspense>
      )
    }

    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(boundary("first"))
      await Promise.resolve()
    })
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("first failure"))
    expect(loadCatalog).toHaveBeenCalledOnce()

    await act(async () => {
      view.rerender(boundary("second"))
      await Promise.resolve()
    })
    await waitFor(() => expect(view.getByRole("alert").textContent).toBe("second failure"))
    expect(loadCatalog).toHaveBeenCalledTimes(2)

    await act(async () => {
      view.rerender(boundary("success"))
      await Promise.resolve()
    })
    await waitFor(() => expect(view.container.textContent).toBe("Ready"))
    expect(loadCatalog).toHaveBeenCalledTimes(3)
  })
})
