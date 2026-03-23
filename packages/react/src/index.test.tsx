import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"

import { createI18n } from "@palamedes/core"
import { resetI18nRuntime, setServerI18nGetter } from "@palamedes/runtime"

import { Plural, Trans } from "./index"

describe("@palamedes/react", () => {
  afterEach(() => {
    resetI18nRuntime()
  })

  it("renders Trans without a provider by reading the active runtime instance", () => {
    const i18n = createI18n()
    i18n.load("de", {
      footer: "Bereitgestellt von <0>Palamedes</0>",
    })
    i18n.activate("de")
    setServerI18nGetter(() => i18n)

    const html = renderToStaticMarkup(
      <Trans
        id="footer"
        message="Powered by <0>Palamedes</0>"
        components={{ 0: <strong /> }}
      />
    )

    expect(html).toBe("Bereitgestellt von <strong>Palamedes</strong>")
  })

  it("renders plural output through the active runtime instance", () => {
    const i18n = createI18n()
    setServerI18nGetter(() => i18n)

    const html = renderToStaticMarkup(<Plural value={2} one="# item" other="# items" />)

    expect(html).toBe("2 items")
  })
})
