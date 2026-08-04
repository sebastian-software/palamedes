// @vitest-environment node
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

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

describe("createClientCatalogBoundary on the server", () => {
  afterEach(() => resetI18nRuntime())

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
})
