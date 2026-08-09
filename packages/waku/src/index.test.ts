import { afterEach, describe, expect, it, vi } from "vitest"

import { getI18n, resetI18nRuntime, type I18nInstance } from "@palamedes/runtime"
import { createServerI18nScope } from "@palamedes/runtime/server"

import { createWakuI18nInterceptor } from "./index"
import { createScopedWakuI18nRunner } from "./scope"

const getRequest = vi.hoisted(() => vi.fn())

vi.mock("waku/router/server", () => ({ unstable_getRequest: getRequest }))

function createTestI18n(locale: string): I18nInstance {
  return {
    locale,
    _: (message: string) => `${locale}:${message}`,
  }
}

describe("Waku i18n request scope", () => {
  afterEach(() => {
    resetI18nRuntime()
    getRequest.mockReset()
  })

  it("skips request-local activation during static generation", async () => {
    getRequest.mockImplementation(() => {
      throw new Error("Request is not available.")
    })
    const resolveI18n = vi.fn(() => createTestI18n("de"))
    const interceptor = createWakuI18nInterceptor(resolveI18n)

    await expect(interceptor(async () => "static output")).resolves.toBe("static output")

    expect(resolveI18n).not.toHaveBeenCalled()
  })

  it("activates the request-local scope for a handled request", async () => {
    const request = new Request("https://example.test/", { headers: { "x-locale": "de" } })
    getRequest.mockReturnValue(request)
    const resolveI18n = vi.fn(() => createTestI18n("de"))
    const interceptor = createWakuI18nInterceptor(resolveI18n)

    await expect(
      interceptor(async () => {
        expect(getI18n().locale).toBe("de")
        return "request output"
      })
    ).resolves.toBe("request output")

    expect(resolveI18n).toHaveBeenCalledWith(request)
  })

  it("uses original request headers and cookies before server-action work runs", async () => {
    const runner = createScopedWakuI18nRunner((request) => {
      expect(request.headers.get("cookie")).toBe("locale=de")
      expect(request.headers.get("x-request-id")).toBe("request-1")
      return createTestI18n(request.headers.get("cookie") === "locale=de" ? "de" : "en")
    })

    await runner.run(
      new Request("https://example.test/RSC/action", {
        headers: { cookie: "locale=de", "x-request-id": "request-1" },
      }),
      async () => {
        expect(getI18n().locale).toBe("de")
        await Promise.resolve()
        expect(getI18n()._("message")).toBe("de:message")
      }
    )

    expect(() => getI18n()).toThrow("No active server i18n instance")
  })

  it("keeps concurrent requests isolated through nested async work", async () => {
    const runner = createScopedWakuI18nRunner((request) =>
      createTestI18n(request.headers.get("x-locale") ?? "en")
    )

    await Promise.all(
      ["de", "en"].map((locale) =>
        runner.run(
          new Request("https://example.test/RSC/action", { headers: { "x-locale": locale } }),
          async () => {
            await Promise.resolve()
            expect(getI18n().locale).toBe(locale)
          }
        )
      )
    )
  })

  it("does not invoke an action when initialization fails and restores an outer scope", async () => {
    const outerScope = createServerI18nScope<I18nInstance>()
    const outerI18n = createTestI18n("en")
    const runner = createScopedWakuI18nRunner(async () => {
      throw new Error("catalog is unavailable")
    })

    await outerScope.run(outerI18n, async () => {
      await expect(
        runner.run(new Request("https://example.test/RSC/action"), async () => {
          throw new Error("action must not run")
        })
      ).rejects.toThrow("Palamedes Waku i18n initialization failed before the handler ran.")
      expect(getI18n()).toBe(outerI18n)
    })
  })

  it("restores an outer request scope after a nested server-action invocation", async () => {
    const runner = createScopedWakuI18nRunner((request) =>
      createTestI18n(request.headers.get("x-locale") ?? "en")
    )

    await runner.run(
      new Request("https://example.test/RSC/outer", { headers: { "x-locale": "de" } }),
      async () => {
        await runner.run(
          new Request("https://example.test/RSC/inner", { headers: { "x-locale": "en" } }),
          () => {
            expect(getI18n().locale).toBe("en")
          }
        )
        expect(getI18n().locale).toBe("de")
      }
    )
  })

  it("keeps streaming callbacks created by the handler in the active scope", async () => {
    const runner = createScopedWakuI18nRunner(() => createTestI18n("de"))
    const stream = await runner.run(new Request("https://example.test/RSC/action"), async () => {
      await Promise.resolve()
      expect(getI18n().locale).toBe("de")
      return new ReadableStream({
        pull(controller) {
          expect(getI18n().locale).toBe("de")
          controller.close()
        },
      })
    })

    await new Response(stream).text()
    expect(() => getI18n()).toThrow("No active server i18n instance")
  })
})
