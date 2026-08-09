import { afterEach, describe, expect, it } from "vitest"

import { getI18n, resetI18nRuntime, type I18nInstance } from "@palamedes/runtime"
import { createServerI18nScope } from "@palamedes/runtime/server"

import { createScopedTanStackI18nRunner } from "./scope"

function createTestI18n(locale: string): I18nInstance {
  return {
    locale,
    _: (message: string) => `${locale}:${message}`,
  }
}

describe("TanStack i18n request scope", () => {
  afterEach(() => {
    resetI18nRuntime()
  })

  it("uses original request headers and cookies before server-function work runs", async () => {
    const runner = createScopedTanStackI18nRunner((request) => {
      expect(request.headers.get("cookie")).toBe("locale=de")
      expect(request.headers.get("x-request-id")).toBe("request-1")
      return createTestI18n(request.headers.get("cookie") === "locale=de" ? "de" : "en")
    })

    await runner.run(
      new Request("https://example.test/_serverFn/probe", {
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
    const runner = createScopedTanStackI18nRunner((request) =>
      createTestI18n(request.headers.get("x-locale") ?? "en")
    )

    await Promise.all(
      ["de", "en"].map((locale) =>
        runner.run(
          new Request("https://example.test/_serverFn/probe", {
            headers: { "x-locale": locale },
          }),
          async () => {
            await Promise.resolve()
            expect(getI18n().locale).toBe(locale)
          }
        )
      )
    )
  })

  it("does not invoke the handler when initialization fails and restores an outer scope", async () => {
    const outerScope = createServerI18nScope<I18nInstance>()
    const outerI18n = createTestI18n("en")
    const failure = new Error("catalog is unavailable")
    const runner = createScopedTanStackI18nRunner(async () => {
      throw failure
    })

    await outerScope.run(outerI18n, async () => {
      await expect(
        runner.run(new Request("https://example.test/_serverFn/probe"), async () => {
          throw new Error("handler must not run")
        })
      ).rejects.toMatchObject({
        message:
          "Palamedes TanStack i18n initialization failed before server-function dispatch ran.",
        cause: failure,
      })
      expect(getI18n()).toBe(outerI18n)
    })
  })

  it("restores an outer request scope after a nested server-function invocation", async () => {
    const runner = createScopedTanStackI18nRunner((request) =>
      createTestI18n(request.headers.get("x-locale") ?? "en")
    )

    await runner.run(
      new Request("https://example.test/_serverFn/outer", { headers: { "x-locale": "de" } }),
      async () => {
        await runner.run(
          new Request("https://example.test/_serverFn/inner", { headers: { "x-locale": "en" } }),
          () => {
            expect(getI18n().locale).toBe("en")
          }
        )
        expect(getI18n().locale).toBe("de")
      }
    )
  })
})
