import { afterEach, describe, expect, it } from "vitest"

import { getI18n, resetI18nRuntime, type I18nInstance } from "@palamedes/runtime"

import { createRemixI18nRequestScope } from "./server"

function createTestI18n(locale: string): I18nInstance {
  return {
    locale,
    _: (id: string) => `${locale}:${id}`,
  }
}

describe("createRemixI18nRequestScope", () => {
  afterEach(() => {
    resetI18nRuntime()
  })

  it("runs request handlers with the resolved server i18n instance", async () => {
    const remixI18n = createRemixI18nRequestScope((request) => {
      const locale = request.headers.get("accept-language")?.startsWith("de") ? "de" : "en"
      return createTestI18n(locale)
    })

    const response = await remixI18n.run(
      new Request("https://example.test/", {
        headers: { "accept-language": "de" },
      }),
      (i18n) => {
        expect(remixI18n.get()).toBe(i18n)
        expect(getI18n()).toBe(i18n)
        return new Response(String(getI18n()._("checkout.title")), {
          headers: { "x-locale": i18n.locale ?? "" },
        })
      }
    )

    expect(response.headers.get("x-locale")).toBe("de")
    expect(await response.text()).toBe("de:checkout.title")
    expect(remixI18n.get()).toBeUndefined()
  })

  it("keeps concurrent requests isolated", async () => {
    const remixI18n = createRemixI18nRequestScope(async (request) =>
      createTestI18n(request.headers.get("x-locale") ?? "en")
    )

    await Promise.all([
      remixI18n.run(
        new Request("https://example.test/", { headers: { "x-locale": "de" } }),
        async (i18n) => {
          await Promise.resolve()
          expect(getI18n()).toBe(i18n)
          expect(getI18n().locale).toBe("de")
        }
      ),
      remixI18n.run(
        new Request("https://example.test/", { headers: { "x-locale": "en" } }),
        async (i18n) => {
          await Promise.resolve()
          expect(getI18n()).toBe(i18n)
          expect(getI18n().locale).toBe("en")
        }
      ),
    ])
  })
})
