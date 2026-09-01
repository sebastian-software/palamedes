import { afterEach, describe, expect, it, vi } from "vitest"

import { defineLocaleControls } from "@palamedes/core/locale"
import { getI18n, resetI18nRuntime, type I18nInstance } from "@palamedes/runtime"
import { createRouter } from "remix/router"

import { createRemixI18nRequestScope, createRemixI18nServer } from "./server"

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
          headers: { "x-locale": i18n.locale },
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

  it("wraps resolver failures without entering the request callback", async () => {
    const failure = new Error("catalog is unavailable")
    const remixI18n = createRemixI18nRequestScope(async () => {
      throw failure
    })

    await expect(
      remixI18n.run(new Request("https://example.test/"), () => {
        throw new Error("callback must not run")
      })
    ).rejects.toMatchObject({
      message: "Palamedes Remix i18n initialization failed before the handler ran.",
      cause: failure,
    })
  })

  it("keeps request scope active while a returned response body is streamed", async () => {
    const remixI18n = createRemixI18nRequestScope(() => createTestI18n("de"))
    const encoder = new TextEncoder()
    let sent = false

    const response = await remixI18n.run(
      new Request("https://example.test/"),
      () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              if (sent) {
                controller.close()
                return
              }

              sent = true
              controller.enqueue(encoder.encode(String(getI18n()._("streamed.title"))))
            },
          })
        )
    )

    expect(remixI18n.get()).toBeUndefined()
    expect(await response.text()).toBe("de:streamed.title")
  })
})

describe("createRemixI18nServer", () => {
  afterEach(() => {
    resetI18nRuntime()
  })

  const locales = defineLocaleControls({
    locales: ["en", "de", "es"],
    defaultLocale: "en",
    cookies: { locale: "locale" },
  })

  it("resolves request locale and caches catalog messages by locale", async () => {
    const loadMessages = vi.fn((locale: "en" | "de" | "es") => ({
      greeting: `${locale}:Hallo`,
    }))
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages,
    })

    await remixI18n.run(
      new Request("https://example.test/", {
        headers: { "accept-language": "de" },
      }),
      ({ i18n, locale }) => {
        expect(locale).toBe("de")
        expect(getI18n()).toBe(i18n)
        expect(remixI18n.get()).toStrictEqual({
          i18n,
          locale: "de",
          source: "accept-language",
        })
        expect(i18n._("greeting")).toBe("de:Hallo")
      }
    )

    await remixI18n.run(
      new Request("https://example.test/", {
        headers: { "accept-language": "de" },
      }),
      ({ i18n }) => {
        expect(i18n._("greeting")).toBe("de:Hallo")
      }
    )

    expect(loadMessages).toHaveBeenCalledTimes(1)
  })

  it("returns the scoped context source without a router context", async () => {
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: (locale) => ({ greeting: `hello:${locale}` }),
    })

    await remixI18n.run(
      new Request("https://example.test/", {
        headers: { cookie: "locale=es", "accept-language": "de" },
      }),
      ({ i18n }) => {
        expect(remixI18n.get()).toStrictEqual({
          i18n,
          locale: "es",
          source: "cookie",
        })
      }
    )

    expect(remixI18n.get()).toBeUndefined()
  })

  it("wraps Remix router handlers with middleware request scope", async () => {
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: (locale) => ({ greeting: `hello:${locale}` }),
    })
    const router = createRouter({ middleware: [remixI18n.middleware()] })

    router.get("/", (context) => {
      const palamedes = remixI18n.get(context)
      return new Response(`${palamedes?.locale}:${getI18n()._("greeting")}`)
    })

    const response = await router.fetch(
      new Request("https://example.test/", {
        headers: { cookie: "locale=es", "accept-language": "de" },
      })
    )

    expect(await response.text()).toBe("es:hello:es")
  })

  it("creates the browser bootstrap from the server-selected cookie locale", async () => {
    const loadClientMessages = vi.fn((locale: "en" | "de" | "es") => ({
      greeting: locale === "de" ? "Hallo" : `Hello ${locale}`,
    }))
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: (locale) => ({ greeting: `server:${locale}` }),
      loadClientMessages,
    })

    const bootstrap = await remixI18n.run(
      new Request("https://example.test/", {
        headers: { cookie: "locale=de", "accept-language": "en" },
      }),
      ({ locale }) => remixI18n.createClientBootstrap(locale)
    )

    expect(bootstrap).toMatchObject({
      locale: "de",
      messages: { greeting: "Hallo" },
    })
    expect(bootstrap.catalogVersion).toMatch(/^[a-f0-9]{64}$/u)
    expect(remixI18n.createClientBootstrap("de")).toBe(bootstrap)
    expect(loadClientMessages).toHaveBeenCalledTimes(1)
  })

  it("produces stable catalog versions independent of message insertion order", () => {
    const first = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: () => ({ second: "Two", first: "One" }),
    }).createClientBootstrap("en")
    const second = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: () => ({ first: "One", second: "Two" }),
    }).createClientBootstrap("en")

    expect(first.catalogVersion).toBe(second.catalogVersion)
  })

  it("renders inert HTML without allowing a catalog to terminate the template", () => {
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: () => ({ dangerous: "</template><script>alert(1)</script>&" }),
      catalogVersion: "release-42",
    })

    const html = remixI18n.renderClientBootstrap("en", {
      elementId: 'catalog"><script>',
    })

    expect(html).toContain('<template id="catalog&quot;>&lt;script>">')
    expect(html).toContain('"catalogVersion":"release-42"')
    expect(html).toContain("\\u003c/template>\\u003cscript>alert(1)\\u003c/script>\\u0026")
    expect(html).not.toContain("</template><script>")
    expect(html).not.toContain(".po")
  })

  it("rejects executable server catalogs unless serializable client messages are supplied", () => {
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: () => ({ greeting: () => "Hello" }) as unknown as Record<string, string>,
    })

    expect(() => remixI18n.createClientBootstrap("en")).toThrow(
      /non-string message "greeting".*loadClientMessages.*compileCatalogArtifact/u
    )
  })

  it("uses a new document payload after cookie-driven locale navigation", async () => {
    const remixI18n = createRemixI18nServer({
      locales,
      strategy: "cookie",
      loadMessages: (locale) => ({ greeting: `greeting:${locale}` }),
    })

    const localeFor = (cookie: string) =>
      remixI18n.run(
        new Request("https://example.test/", { headers: { cookie } }),
        ({ locale }) => remixI18n.createClientBootstrap(locale).locale
      )

    await expect(localeFor("locale=en")).resolves.toBe("en")
    await expect(localeFor("locale=es")).resolves.toBe("es")
  })
})
