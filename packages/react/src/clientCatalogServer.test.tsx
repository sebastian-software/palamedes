// @vitest-environment node
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createI18n,
  defineCompiledCatalog,
  type CompiledCatalogMessages,
} from "@palamedes/core/compiled"
import { getI18n, resetI18nRuntime } from "@palamedes/runtime"
import { createServerI18nScope } from "@palamedes/runtime/server"

import { createClientCatalogBoundary } from "./client"

type Locale = "de" | "en"

function fulfilled<T>(value: T): Promise<T> {
  const promise = Promise.resolve(value) as Promise<T> & {
    status: "fulfilled"
    value: T
  }
  promise.status = "fulfilled"
  promise.value = value
  return promise
}

function rejected<T>(reason: unknown): Promise<T> {
  const promise = Promise.reject(reason) as Promise<T> & {
    status: "rejected"
    reason: unknown
  }
  promise.status = "rejected"
  promise.reason = reason
  return promise
}

describe("createClientCatalogBoundary on the server", () => {
  afterEach(() => resetI18nRuntime())

  it("uses the configured i18n factory during server rendering", () => {
    const createConfiguredI18n = vi.fn(() =>
      createI18n({ locale: "en", timeZone: "Europe/Berlin" })
    )
    const Boundary = createClientCatalogBoundary<Locale>({
      createI18n: createConfiguredI18n,
      loadCatalog: () => fulfilled({ messages: defineCompiledCatalog({}) }),
      resolveClientLocale() {
        throw new Error("resolveClientLocale must not run on the server")
      },
    })

    function ActiveTimeZone() {
      return getI18n<ReturnType<typeof createI18n>>().timeZone
    }

    const scope = createServerI18nScope<ReturnType<typeof createI18n>>()
    const html = scope.run(createI18n(), () =>
      renderToStaticMarkup(
        <Boundary locale="en">
          <ActiveTimeZone />
        </Boundary>
      )
    )

    expect(html).toBe("Europe/Berlin")
    expect(createConfiguredI18n).toHaveBeenCalledTimes(1)
  })

  it("keeps hook-free Client Component SSR activation request-local", async () => {
    const catalogs: Record<Locale, CompiledCatalogMessages> = {
      de: defineCompiledCatalog({ greeting: "Hallo" }),
      en: defineCompiledCatalog({ greeting: "Hello" }),
    }
    const Boundary = createClientCatalogBoundary<Locale>({
      loadCatalog: (locale) => fulfilled({ messages: catalogs[locale] }),
      resolveClientLocale() {
        throw new Error("resolveClientLocale must not run on the server")
      },
    })
    const scope = createServerI18nScope<ReturnType<typeof createI18n>>()

    function Greeting() {
      return String(getI18n()._("greeting"))
    }

    async function renderLocale(locale: Locale): Promise<string> {
      const seed = createI18n({ locale })
      return scope.run(seed, async () => {
        await Promise.resolve()
        return renderToStaticMarkup(
          <Boundary locale={locale}>
            <Greeting />
          </Boundary>
        )
      })
    }

    const [deHtml, enHtml] = await Promise.all([renderLocale("de"), renderLocale("en")])

    expect(deHtml).toBe("Hallo")
    expect(enHtml).toBe("Hello")
  })

  it("rethrows failed server loads, then caches the retry that succeeds", async () => {
    const loadError = new Error("catalog unavailable")
    const loadCatalog = vi
      .fn<() => Promise<{ messages: CompiledCatalogMessages }>>()
      .mockReturnValueOnce(rejected(loadError))
      .mockReturnValueOnce(fulfilled({ messages: defineCompiledCatalog({ greeting: "Hallo" }) }))
    const Boundary = createClientCatalogBoundary<Locale>({
      loadCatalog,
      resolveClientLocale() {
        throw new Error("resolveClientLocale must not run on the server")
      },
    })

    function Greeting() {
      return String(getI18n()._("greeting"))
    }

    const renderGreeting = () =>
      renderToStaticMarkup(
        <Boundary locale="de">
          <Greeting />
        </Boundary>
      )

    expect(renderGreeting).toThrow(loadError)
    await Promise.resolve()
    expect(renderGreeting()).toBe("Hallo")
    expect(renderGreeting()).toBe("Hallo")
    expect(loadCatalog).toHaveBeenCalledTimes(2)
  })

  it("evicts each rejected server load before the next render", async () => {
    const firstError = new Error("first failure")
    const secondError = new Error("second failure")
    const loadCatalog = vi
      .fn<() => Promise<{ messages: CompiledCatalogMessages }>>()
      .mockReturnValueOnce(rejected(firstError))
      .mockReturnValueOnce(rejected(secondError))
      .mockReturnValueOnce(fulfilled({ messages: defineCompiledCatalog({ greeting: "Hallo" }) }))
    const Boundary = createClientCatalogBoundary<Locale>({
      loadCatalog,
      resolveClientLocale() {
        throw new Error("resolveClientLocale must not run on the server")
      },
    })

    const renderBoundary = () => renderToStaticMarkup(<Boundary locale="de">Ready</Boundary>)

    expect(renderBoundary).toThrow(firstError)
    await Promise.resolve()
    expect(renderBoundary).toThrow(secondError)
    await Promise.resolve()
    expect(renderBoundary()).toBe("Ready")
    expect(loadCatalog).toHaveBeenCalledTimes(3)
  })
})
