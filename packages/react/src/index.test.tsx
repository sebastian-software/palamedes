// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  createI18n,
  defineCompiledCatalog,
  type CompiledMessage,
  type PalamedesI18n,
} from "@palamedes/core"
import {
  createI18n as createCompiledI18n,
  defineCompiledCatalog as defineParserFreeCatalog,
  type CompiledMessage as ParserFreeMessage,
} from "@palamedes/core/compiled"
import { resetI18nRuntime, setClientI18n } from "@palamedes/runtime"

import { Plural, Select, SelectOrdinal, Trans, buildLocaleSwitchItems } from "./index"
import { Trans as CompiledTrans } from "./compiled"

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

  it("executes generated message functions directly through the React renderer", () => {
    const footer: CompiledMessage = (values, runtime) =>
      runtime.join(
        "Hallo ",
        runtime.value(values, "name"),
        ", ",
        runtime.tag("0", runtime.join("willkommen"))
      )
    const i18n = createI18n({ locale: "de" })
    i18n.load("de", defineCompiledCatalog({ footer }))
    setClientI18n(i18n)

    const html = renderToStaticMarkup(
      <Trans
        id="footer"
        message="Hello {name}, <0>welcome</0>"
        values={{ name: "Ada" }}
        components={{ 0: <strong /> }}
      />
    )

    expect(html).toBe("Hallo Ada, <strong>willkommen</strong>")
  })

  it("renders generated messages through the parser-free production entry", () => {
    const greeting: ParserFreeMessage = (values, runtime) =>
      runtime.join("Hallo ", runtime.value(values, "name"))
    const i18n = createCompiledI18n({ locale: "de" })
    i18n.load("de", defineParserFreeCatalog({ greeting }))
    setClientI18n(i18n)

    expect(
      renderToStaticMarkup(<CompiledTrans id="greeting" values={{ name: "Ada" }} components={{}} />)
    ).toBe("Hallo Ada")
  })

  it("formats uncompiled compat messages with the parser-free runtime", () => {
    const i18n = createCompiledI18n({ locale: "en-US" })
    setClientI18n(i18n)
    const when = new Date(Date.UTC(2026, 4, 8, 12, 0, 0))

    const html = renderToStaticMarkup(
      <>
        <Trans id="greeting" message="Hello {name}" values={{ name: "Ada" }} />
        <Trans id="date" message="{when, date, full}" values={{ when }} />
        <Plural value={3} one="# item" other="# items" />
        <Select value="female" female="She" other="They" />
        <SelectOrdinal value={3} one="#st" two="#nd" few="#rd" other="#th" />
      </>
    )

    expect(html).toBe(
      `Hello Ada${new Intl.DateTimeFormat("en-US", { dateStyle: "full" }).format(when)}3 itemsShe3rd`
    )
  })

  it("keeps root compat components on generated parser-free catalog entries", () => {
    const greeting: ParserFreeMessage = (values, runtime) =>
      runtime.join("Hallo ", runtime.value(values, "name"))
    const i18n = createCompiledI18n({ locale: "de" })
    i18n.load("de", defineParserFreeCatalog({ greeting }))
    setClientI18n(i18n)

    expect(
      renderToStaticMarkup(<Trans id="greeting" message="Hello {name}" values={{ name: "Ada" }} />)
    ).toBe("Hallo Ada")
  })

  it("parses lazy patterns without re-entering catalog lookup", () => {
    const greeting: CompiledMessage = (values, runtime) => runtime.pattern("Hello {name}", values)
    const i18n = createI18n({ locale: "de" })
    i18n.load(
      "de",
      defineCompiledCatalog({
        greeting,
        "Hello {name}": "Falscher Katalogtreffer",
      })
    )
    setClientI18n(i18n)

    const html = renderToStaticMarkup(
      <CompiledTrans id="greeting" values={{ name: "Ada" }} components={{}} />
    )

    expect(html).toBe("Hello Ada")
  })

  it("keeps rendering with older i18n instances that have no renderMessage hook", () => {
    const i18n = createI18n({ locale: "de" })
    i18n.load("de", {
      footer: "Hallo {name}, <0>willkommen</0>",
    })
    const legacyI18n: PalamedesI18n = { ...i18n }
    delete legacyI18n.renderMessage
    setClientI18n(legacyI18n)

    const html = renderToStaticMarkup(
      <Trans
        id="footer"
        message="Hello {name}, <0>welcome</0>"
        values={{ name: "Ada" }}
        components={{ 0: <strong /> }}
      />
    )

    expect(html).toBe("Hallo Ada, <strong>willkommen</strong>")
  })

  it("formats compiled Trans fallbacks with older parser-capable i18n instances", () => {
    const i18n = createI18n({ locale: "de" })
    i18n.load("de", {
      inbox: "{count, plural, one {Eine Nachricht} other {# Nachrichten}}",
    })
    const legacyI18n: PalamedesI18n = { ...i18n }
    delete legacyI18n.renderMessage
    setClientI18n(legacyI18n)

    const html = renderToStaticMarkup(
      <CompiledTrans id="inbox" message="Hello {name}" values={{ name: "Ada" }} components={{}} />
    )

    expect(html).toBe("Hello Ada")
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

  it("rejects invalid offsets at the direct component boundary", () => {
    const i18n = createI18n()
    setClientI18n(i18n)

    for (const offset of [Number.NaN, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        renderToStaticMarkup(<Plural value={2} offset={offset} one="# item" other="# items" />)
      ).toThrow("Plural offset must be a non-negative safe integer.")
    }
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

  it("translates direct choice components through the active catalog", () => {
    const i18n = createI18n()
    i18n.load("de", {
      "{value, plural, one {# item} other {# items}}":
        "{value, plural, one {# Artikel} other {# Artikel}}",
    })
    i18n.activate("de")
    setClientI18n(i18n)

    const html = renderToStaticMarkup(<Plural value={2} one="# item" other="# items" />)

    expect(html).toBe("2 Artikel")
  })

  it("normalizes _N exact-match props like the macro transform", () => {
    const i18n = createI18n()
    i18n.activate("en")
    setClientI18n(i18n)

    const html = renderToStaticMarkup(
      <>
        <Plural value={2} _2="a pair" other="# items" />
        <Plural value={3} _2="a pair" other="# items" />
      </>
    )

    expect(html).toBe("a pair3 items")
  })

  it("rejects invalid plural option props instead of emitting dead branches", () => {
    const i18n = createI18n()
    i18n.activate("en")
    setClientI18n(i18n)

    expect(() =>
      renderToStaticMarkup(<Plural value={2} {...{ _pair: "a pair" }} other="# items" />)
    ).toThrow(/Invalid plural option "_pair"/)
  })

  it("rejects choice components without any usable option instead of rendering nothing", () => {
    const i18n = createI18n()
    i18n.activate("en")
    setClientI18n(i18n)

    expect(() =>
      renderToStaticMarkup(
        <Plural value={2} {...({ other: undefined } as unknown as { other: string })} />
      )
    ).toThrow(/plural component requires at least one string option/)
  })

  it("never resolves select values to Object.prototype members", () => {
    const i18n = createI18n()
    i18n.activate("en")
    setClientI18n(i18n)

    const html = renderToStaticMarkup(
      <>
        <Select value="valueOf" other="fallback" />
        <Select value="toString" other="fallback" />
        <Select value="hasOwnProperty" other="fallback" />
      </>
    )

    expect(html).toBe("fallbackfallbackfallback")
  })

  it("rejects choice option text with unbalanced braces instead of corrupting the pattern", () => {
    const i18n = createI18n()
    i18n.activate("en")
    setClientI18n(i18n)

    expect(() => renderToStaticMarkup(<Select value="a" a="a } b}" other="other" />)).toThrow(
      /invalid ICU pattern/
    )
  })

  it("renders Date values deterministically like the core string renderer", () => {
    const i18n = createI18n()
    i18n.activate("en")
    setClientI18n(i18n)

    const when = new Date(Date.UTC(2026, 6, 24, 2, 0, 0))
    const html = renderToStaticMarkup(<Trans id="when" message="At {when}" values={{ when }} />)

    expect(html).toBe(`At ${when.toISOString()}`)
  })

  it("reports missing plural values instead of matching zero branches", () => {
    const onError = vi.fn()
    const i18n = createI18n({ onError })
    i18n.activate("en")
    setClientI18n(i18n)

    // Same contract as `i18n._()`: report, then degrade to the raw source
    // message rather than throwing out of the render.
    const html = renderToStaticMarkup(
      <Trans id="items" message="{n, plural, =0 {none} other {# items}}" values={{}} />
    )

    expect(html).toBe("{n, plural, =0 {none} other {# items}}")
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0].error.message).toMatch(/Missing or non-numeric value/)
  })

  it("falls back to the source message when a catalog plural cannot resolve", () => {
    const onError = vi.fn()
    const i18n = createI18n({ onError })
    // A translator introduced a plural the source never had, and nothing
    // supplies `count`: resolving it throws mid-render.
    i18n.load("de", {
      inbox: "{count, plural, one {Eine Nachricht} other {# Nachrichten}}",
    })
    i18n.activate("de")
    setClientI18n(i18n)

    const html = renderToStaticMarkup(
      <Trans id="inbox" message="You have <0>mail</0>" components={{ 0: <strong /> }} />
    )

    expect(html).toBe("You have <strong>mail</strong>")
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      id: "inbox",
      locale: "de",
      pattern: "{count, plural, one {Eine Nachricht} other {# Nachrichten}}",
      fallback: "You have <0>mail</0>",
    })
  })

  it("keeps direct choice components rendering when a catalog override cannot resolve", () => {
    const onError = vi.fn()
    const i18n = createI18n({ onError })
    i18n.load("de", {
      "{value, select, female {She} other {They}}":
        "{missing, plural, one {Sie} other {# Personen}}",
    })
    i18n.activate("de")
    setClientI18n(i18n)

    const html = renderToStaticMarkup(<Select value="female" female="She" other="They" />)

    expect(html).toBe("She")
    expect(onError).toHaveBeenCalledOnce()
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
})
