/* @jsxImportSource solid-js */
import { renderToString } from "solid-js/web/dist/server.js"
import { afterEach, describe, expect, it } from "vitest"

import { createI18n } from "@palamedes/core"
import { resetI18nRuntime, setServerI18nGetter } from "@palamedes/runtime"

import { Plural, Trans } from "./index"

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
})
