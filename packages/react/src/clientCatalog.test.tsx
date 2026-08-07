// @vitest-environment jsdom
import { Suspense } from "react"
import { act, render, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { defineCompiledCatalog } from "@palamedes/core/compiled"
import { getI18n, resetI18nRuntime } from "@palamedes/runtime"

import { createClientCatalogBoundary } from "./client"

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
    const loadCatalog = vi
      .fn<() => Promise<CatalogModule>>()
      .mockRejectedValueOnce(new Error("catalog unavailable"))
      .mockResolvedValueOnce(catalog("Hallo"))
    const Boundary = createClientCatalogBoundary<Locale>({
      loadCatalog,
      resolveClientLocale: () => document.documentElement.lang as Locale,
    })
    expect(loadCatalog).toHaveBeenCalledOnce()

    function Greeting() {
      return <span>{String(getI18n()._("greeting"))}</span>
    }

    function boundary() {
      return (
        <Suspense fallback={<span>Loading</span>}>
          <Boundary locale="de">
            <Greeting />
          </Boundary>
        </Suspense>
      )
    }

    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(boundary())
      await Promise.resolve()
    })
    await waitFor(() => expect(view.container.textContent).toBe("Hallo"))
    expect(loadCatalog).toHaveBeenCalledTimes(2)

    await act(async () => {
      view.rerender(boundary())
    })
    expect(view.container.textContent).toBe("Hallo")
    expect(loadCatalog).toHaveBeenCalledTimes(2)
  })

  it("observes a rejected preload before the boundary renders", async () => {
    document.documentElement.lang = "de"
    const preload = deferred<CatalogModule>()
    const loadCatalog = vi
      .fn<() => Promise<CatalogModule>>()
      .mockReturnValueOnce(preload.promise)
      .mockResolvedValueOnce(catalog("Hallo"))
    const Boundary = createClientCatalogBoundary<Locale>({
      loadCatalog,
      resolveClientLocale: () => document.documentElement.lang as Locale,
    })
    expect(loadCatalog).toHaveBeenCalledOnce()

    await act(async () => {
      preload.reject(new Error("catalog unavailable"))
      await Promise.resolve()
      await Promise.resolve()
    })

    let view!: ReturnType<typeof render>
    await act(async () => {
      view = render(
        <Suspense fallback={<span>Loading</span>}>
          <Boundary locale="de">Ready</Boundary>
        </Suspense>
      )
      await Promise.resolve()
    })
    await waitFor(() => expect(view.container.textContent).toBe("Ready"))
    expect(loadCatalog).toHaveBeenCalledTimes(2)
  })
})
