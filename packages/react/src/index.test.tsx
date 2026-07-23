// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server"
import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createI18n } from "@palamedes/core"
import { resetI18nRuntime, setClientI18n } from "@palamedes/runtime"

import { Plural, Select, SelectOrdinal, Trans, buildLocaleSwitchItems } from "./index"
import { useClientLocale } from "./client"

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
    setClientI18n(i18n)

    const html = renderToStaticMarkup(
      <Trans id="footer" message="Powered by <0>Palamedes</0>" components={{ 0: <strong /> }} />
    )

    expect(html).toBe("Bereitgestellt von <strong>Palamedes</strong>")
  })

  it("renders a self-closing placeholder as a void component", () => {
    const i18n = createI18n()
    i18n.activate("en")
    setClientI18n(i18n)

    const html = renderToStaticMarkup(
      <Trans id="imprint" message="Line one<0/>Line two" components={{ 0: <br /> }} />
    )

    expect(html).toBe("Line one<br/>Line two")
  })

  it("renders plural output through the active runtime instance", () => {
    const i18n = createI18n()
    setClientI18n(i18n)

    const html = renderToStaticMarkup(<Plural value={2} one="# item" other="# items" />)

    expect(html).toBe("2 items")
  })

  it("formats direct choice components without reporting missing catalog entries", () => {
    const onMissing = vi.fn()
    const i18n = createI18n({ onMissing })
    i18n.activate("en")
    setClientI18n(i18n)

    const html = renderToStaticMarkup(
      <>
        <Plural value={2} one="# item" other="# items" />
        <Select value="female" female="She" other="They" />
        <SelectOrdinal value={2} one="#st" two="#nd" other="#th" />
      </>
    )

    expect(html).toBe("2 itemsShe2nd")
    expect(onMissing).not.toHaveBeenCalled()
  })

  it("renders formatted ICU arguments through Trans", () => {
    const i18n = createI18n()
    i18n.activate("en-US")
    setClientI18n(i18n)

    const html = renderToStaticMarkup(
      <Trans
        id="total"
        message="Total: {amount, number, ::currency/EUR}"
        values={{ amount: 12.3 }}
      />
    )

    expect(html).toBe(
      `Total: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(12.3)}`
    )
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

  it("syncs the active client locale through useClientLocale", () => {
    const sync = vi.fn()

    function Probe({ locale }: { locale: "en" | "de" }) {
      useClientLocale(locale, sync)
      return null
    }

    const view = render(<Probe locale="en" />)
    expect(sync).toHaveBeenCalledWith("en")

    view.rerender(<Probe locale="de" />)
    expect(sync).toHaveBeenLastCalledWith("de")
  })
})
