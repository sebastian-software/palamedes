/* @jsxImportSource solid-js */
import { createRenderEffect, createRoot, createSignal } from "solid-js"
import { renderToString } from "solid-js/web/dist/server.js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createI18n } from "@palamedes/core"
import { resetI18nRuntime, setClientI18n, setServerI18nGetter } from "@palamedes/runtime"

import { Plural, Select, SelectOrdinal, Trans, buildLocaleSwitchItems } from "./index"
import { createClientLocaleEffect } from "./client"

describe("@palamedes/solid", () => {
  afterEach(() => {
    resetI18nRuntime()
    delete (globalThis as { window?: unknown }).window
  })

  it("renders Trans without a provider by reading the active runtime instance", () => {
    const i18n = createI18n()
    i18n.load("de", {
      footer: "Bereitgestellt von Palamedes",
    })
    i18n.activate("de")
    setServerI18nGetter(() => i18n)

    const html = renderToString(() => <Trans id="footer" message="Powered by Palamedes" />)

    expect(html).toBe("Bereitgestellt von Palamedes")
  })

  it("re-renders Trans output when the client locale switches", async () => {
    // Pretend we are on the client so `getI18n` reads the client instance.
    ;(globalThis as { window?: unknown }).window = {}

    const previousI18n = createI18n()
    previousI18n.activate("en")
    setClientI18n(previousI18n)
    const previousRender = Trans({
      id: "title",
      message: "Book your seat",
    }) as unknown as () => unknown
    previousRender()
    resetI18nRuntime()

    const i18n = createI18n()
    i18n.load("en", { title: "Book your seat" })
    i18n.load("de", { title: "Sichere dir deinen Platz" })
    i18n.activate("en")
    setClientI18n(i18n)

    const outputs: string[] = []

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const render = Trans({ id: "title", message: "Book your seat" }) as unknown as () => unknown

        createRenderEffect(() => {
          outputs.push([render()].flat().join(""))
        })

        // Switch outside the initial render batch so the reactive update flushes.
        queueMicrotask(() => {
          // A client locale switch re-activates the same instance and republishes it.
          i18n.activate("de")
          setClientI18n(i18n)

          queueMicrotask(() => {
            dispose()
            resolve()
          })
        })
      })
    })

    expect(outputs).toStrictEqual(["Book your seat", "Sichere dir deinen Platz"])
  })

  it("renders plural output through the active runtime instance", () => {
    const i18n = createI18n()
    setServerI18nGetter(() => i18n)

    const html = renderToString(() => <Plural value={2} one="# item" other="# items" />)

    expect(html).toBe("2 items")
  })

  it("applies plural offsets in direct and rich messages", () => {
    const i18n = createI18n()
    i18n.activate("en")
    setServerI18nGetter(() => i18n)

    const direct = renderToString(() => (
      <Plural value={2} offset={1} one="# item" other="# items" />
    ))
    const rich = Trans({
      id: "companions",
      message: "{count, plural, offset:1 one {you and one other} other {you and # others}}",
      values: { count: 3 },
    }) as unknown as () => unknown

    expect(direct).toBe("1 item")
    expect([rich()].flat().join("")).toBe("you and 2 others")
  })

  it("rejects invalid offsets at the direct component boundary", () => {
    const i18n = createI18n()
    setServerI18nGetter(() => i18n)

    for (const offset of [Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        renderToString(() => <Plural value={2} offset={offset} one="# item" other="# items" />)
      ).toThrow("Plural offset must be a non-negative safe integer.")
    }
  })

  it("formats direct choice components without reporting missing catalog entries", () => {
    const onMissing = vi.fn()
    const i18n = createI18n({ onMissing })
    i18n.activate("en")
    setServerI18nGetter(() => i18n)

    const plural = renderToString(() => <Plural value={2} one="# item" other="# items" />)
    const select = renderToString(() => <Select value="female" female="She" other="They" />)
    const ordinal = renderToString(() => (
      <SelectOrdinal value={2} one="#st" two="#nd" other="#th" />
    ))

    expect([plural, select, ordinal]).toStrictEqual(["2 items", "She", "2nd"])
    expect(onMissing).not.toHaveBeenCalled()
  })

  it("renders ICU-quoted syntax literally through Trans", () => {
    const i18n = createI18n()
    i18n.activate("en")
    setServerI18nGetter(() => i18n)

    const render = Trans({
      id: "quoted",
      message: "Literal '{name}': {count, plural, other {'#' of #}}",
      values: { count: 5, name: "ignored" },
    }) as unknown as () => unknown

    expect([render()].flat().join("")).toBe("Literal {name}: # of 5")
  })

  it("falls back when Trans encounters a malformed catalog pattern", () => {
    const onError = vi.fn()
    const i18n = createI18n({ onError })
    i18n.load("de", {
      greeting: "Hallo {name",
    })
    i18n.activate("de")
    setServerI18nGetter(() => i18n)

    const render = Trans({
      id: "greeting",
      message: "Hello {name}",
      values: { name: "Ada" },
    }) as unknown as () => unknown

    expect([render()].flat().join("")).toBe("Hello Ada")
    expect(onError).toHaveBeenCalledOnce()
  })

  it("builds locale switch items headlessly", () => {
    expect(
      buildLocaleSwitchItems({
        currentLocale: "de",
        labels: {
          de: "Deutsch",
          en: "English",
        },
        locales: ["en", "de"] as const,
      })
    ).toStrictEqual([
      { active: false, label: "English", locale: "en", testId: "locale-switch-en" },
      { active: true, label: "Deutsch", locale: "de", testId: "locale-switch-de" },
    ])
  })

  it("syncs the active client locale through createClientLocaleEffect", async () => {
    const calls: Array<"en" | "de"> = []

    await new Promise<void>((resolve) => {
      createRoot((dispose) => {
        const [locale, setLocale] = createSignal<"en" | "de">("en")

        createClientLocaleEffect(locale, (nextLocale) => {
          calls.push(nextLocale)
        })

        queueMicrotask(() => {
          setLocale("de")
          queueMicrotask(() => {
            dispose()
            resolve()
          })
        })
      })
    })

    expect(calls).toStrictEqual(["en", "de"])
  })
})
