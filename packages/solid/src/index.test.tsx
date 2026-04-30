/* @jsxImportSource solid-js */
import { createRoot, createSignal } from "solid-js"
import { renderToString } from "solid-js/web/dist/server.js"
import { afterEach, describe, expect, it } from "vitest"

import { createI18n } from "@palamedes/core"
import { resetI18nRuntime, setServerI18nGetter } from "@palamedes/runtime"

import { Plural, Trans, buildLocaleSwitchItems } from "./index"
import { createClientLocaleEffect } from "./client"

describe("@palamedes/solid", () => {
  afterEach(() => {
    resetI18nRuntime()
  })

  it("renders Trans without a provider by reading the active runtime instance", () => {
    const i18n = createI18n()
    i18n.load("de", {
      footer: "Bereitgestellt von Palamedes",
    })
    i18n.activate("de")
    setServerI18nGetter(() => i18n)

    const html = renderToString(() => (
      <Trans
        id="footer"
        message="Powered by Palamedes"
      />
    ))

    expect(html).toBe("Bereitgestellt von Palamedes")
  })

  it("renders plural output through the active runtime instance", () => {
    const i18n = createI18n()
    setServerI18nGetter(() => i18n)

    const html = renderToString(() => <Plural value={2} one="# item" other="# items" />)

    expect(html).toBe("2 items")
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
    ).toEqual([
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

    expect(calls).toEqual(["en", "de"])
  })
})
