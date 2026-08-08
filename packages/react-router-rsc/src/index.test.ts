import { afterEach, describe, expect, it } from "vitest"

import { getI18n, resetI18nRuntime, type I18nInstance } from "@palamedes/runtime"

import { createReactRouterRscI18nRequestScope } from "./index"

function createTestI18n(locale: string): I18nInstance {
  return {
    locale,
    _: (message: string) => `${locale}:${message}`,
  }
}

describe("createReactRouterRscI18nRequestScope", () => {
  afterEach(() => {
    resetI18nRuntime()
  })

  it("resolves the original request before the RSC dispatch runs", async () => {
    const scope = createReactRouterRscI18nRequestScope((request) => {
      expect(request.headers.get("cookie")).toBe("locale=de")
      expect(request.headers.get("accept-language")).toBe("de-DE")
      return createTestI18n("de")
    })

    const result = await scope.run(
      new Request("https://example.test/.rsc", {
        headers: { cookie: "locale=de", "accept-language": "de-DE" },
      }),
      async () => {
        expect(getI18n().locale).toBe("de")
        await Promise.resolve()
        return getI18n()._("direct")
      }
    )

    expect(result).toBe("de:direct")
    expect(() => getI18n()).toThrow("No active server i18n instance")
  })

  it("keeps concurrent RSC and SSR module-graph work isolated", async () => {
    const scope = createReactRouterRscI18nRequestScope((request) =>
      createTestI18n(request.headers.get("x-locale") ?? "en")
    )

    await Promise.all(
      ["de", "en"].map((locale) =>
        scope.run(
          new Request("https://example.test/.rsc", { headers: { "x-locale": locale } }),
          async () => {
            await Promise.resolve()
            const rscGraph = getI18n()._("rsc-helper")
            await Promise.resolve()
            const ssrGraph = getI18n()._("ssr-render")
            expect([rscGraph, ssrGraph]).toStrictEqual([
              `${locale}:rsc-helper`,
              `${locale}:ssr-render`,
            ])
          }
        )
      )
    )
  })

  it("keeps the request scope active for a response stream created by RSC rendering", async () => {
    const scope = createReactRouterRscI18nRequestScope(() => createTestI18n("de"))
    const encoder = new TextEncoder()
    let sent = false

    const response = await scope.run(
      new Request("https://example.test/.rsc"),
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (sent) {
                controller.close()
                return
              }
              sent = true
              controller.enqueue(encoder.encode(String(getI18n()._("streamed"))))
            },
          })
        )
    )

    expect(await response.text()).toBe("de:streamed")
  })

  it("stops dispatch when locale or catalog initialization fails", async () => {
    const scope = createReactRouterRscI18nRequestScope(async () => {
      throw new Error("catalog is unavailable")
    })
    let dispatched = false

    await expect(
      scope.run(new Request("https://example.test/.rsc"), () => {
        dispatched = true
      })
    ).rejects.toThrow(
      "Palamedes React Router RSC i18n initialization failed before RSC dispatch ran."
    )

    expect(dispatched).toBe(false)
  })
})
