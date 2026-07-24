// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server"
import { render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createI18n } from "@palamedes/core"
import { resetI18nRuntime, setClientI18n } from "@palamedes/runtime"
import { createServerI18nScope } from "@palamedes/runtime/server"

import { Plural, Select, SelectOrdinal, Trans, buildLocaleSwitchItems } from "./index"
import { useClientLocale } from "./client"

describe("@palamedes/react", () => {
  afterEach(() => {
    resetI18nRuntime()
    vi.unstubAllGlobals()
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

  it("applies plural offsets in direct and rich messages", () => {
    const i18n = createI18n()
    i18n.activate("en")
    setClientI18n(i18n)

    const direct = renderToStaticMarkup(
      <Plural value={2} offset={1} one="# item" other="# items" />
    )
    const rich = renderToStaticMarkup(
      <Trans
        id="companions"
        message="{count, plural, offset:1 one {you and <0>one</0> other} other {you and <0>#</0> others}}"
        values={{ count: 3 }}
        components={{ 0: <strong /> }}
      />
    )

    expect(direct).toBe("1 item")
    expect(rich).toBe("you and <strong>2</strong> others")
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

  it("renders ICU-quoted syntax literally through Trans", () => {
    const i18n = createI18n()
    i18n.activate("en")
    setClientI18n(i18n)

    const html = renderToStaticMarkup(
      <Trans
        id="quoted"
        message="Literal '{name}': {count, plural, other {'#' of #}}"
        values={{ count: 5, name: "ignored" }}
      />
    )

    expect(html).toBe("Literal {name}: # of 5")
  })

  it("falls back when Trans encounters a malformed catalog pattern", () => {
    const onError = vi.fn()
    const i18n = createI18n({ onError })
    i18n.load("de", {
      greeting: "Hallo {name",
    })
    i18n.activate("de")
    setClientI18n(i18n)

    const html = renderToStaticMarkup(
      <Trans id="greeting" message="Hello {name}" values={{ name: "Ada" }} />
    )

    expect(html).toBe("Hello Ada")
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

  it("syncs the active client locale through useClientLocale", () => {
    const i18n = createI18n()
    i18n.load("en", { greeting: "Hello" })
    i18n.load("de", { greeting: "Hallo" })
    i18n.activate("en")
    setClientI18n(i18n)
    const sync = vi.fn((locale: "en" | "de") => {
      i18n.activate(locale)
      setClientI18n(i18n)
    })

    function Probe({ locale }: { locale: "en" | "de" }) {
      useClientLocale(locale, sync)
      return <Trans id="greeting" message="Greeting" />
    }

    const view = render(<Probe locale="en" />)
    expect(sync).toHaveBeenCalledWith("en")
    expect(view.container.textContent).toBe("Hello")

    view.rerender(<Probe locale="de" />)
    expect(sync).toHaveBeenLastCalledWith("de")
    expect(view.container.textContent).toBe("Hallo")
  })

  it("does not mutate client state during server rendering", async () => {
    vi.stubGlobal("window", undefined)
    const scope = createServerI18nScope<ReturnType<typeof createI18n>>()
    const deI18n = createI18n()
    const enI18n = createI18n()
    deI18n.load("de", { greeting: "Hallo" })
    enI18n.load("en", { greeting: "Hello" })
    deI18n.activate("de")
    enI18n.activate("en")
    const sync = vi.fn()

    function Probe({ locale }: { locale: "en" | "de" }) {
      useClientLocale(locale, sync)
      return <Trans id="greeting" message="Greeting" />
    }

    const [deHtml, enHtml] = await Promise.all([
      scope.run(deI18n, async () => {
        await Promise.resolve()
        return renderToStaticMarkup(<Probe locale="de" />)
      }),
      scope.run(enI18n, async () => {
        await Promise.resolve()
        return renderToStaticMarkup(<Probe locale="en" />)
      }),
    ])

    expect(deHtml).toBe("Hallo")
    expect(enHtml).toBe("Hello")
    expect(sync).not.toHaveBeenCalled()
  })
})
