// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"

import {
  createI18n,
  defineCompiledCatalog,
  type CompiledMessage,
  type CompiledMessageBranch,
} from "@palamedes/core/compiled"
import { resetI18nRuntime, setClientI18n } from "@palamedes/runtime"
import { createElement, type RemixElement } from "remix/ui"
import { renderToString } from "remix/ui/server"
import { render } from "remix/ui/test"

import { Trans, type TransProps } from "./compiled"
import type {
  Plural as MacroPlural,
  Select as MacroSelect,
  SelectOrdinal as MacroSelectOrdinal,
  Trans as MacroTrans,
} from "./macro"
import { createRemixMessageRuntimeCache } from "./transShared"

describe("@palamedes/remix compiled rich-message runtime", () => {
  afterEach(() => {
    resetI18nRuntime()
    document.body.replaceChildren()
  })

  it("renders equivalent rich HTML on the server and in the browser", async () => {
    const message: CompiledMessage = (values, runtime) =>
      runtime.join(
        "Hallo ",
        runtime.value(values, "name"),
        ", ",
        runtime.tag("0", runtime.join("Dokumentation")),
        " — ",
        runtime.value(values, "details")
      )
    const i18n = createI18n({ locale: "de" })
    i18n.load("de", defineCompiledCatalog({ greeting: message }))
    setClientI18n(i18n)

    const props: TransProps = {
      id: "greeting",
      values: {
        name: "Ada",
        details: ["A", [createElement("em", {}, "B"), null, undefined, [], ""], 0],
      },
      components: {
        0: createElement("a", { class: "docs", href: "/docs", title: "Guide" }),
      },
    }
    const serverHtml = await renderToString(createElement(Trans, props))
    const browser = render(createElement(Trans, props))
    expect(serverHtml).toBe(
      'Hallo Ada, <a href="/docs" title="Guide" class="docs">Dokumentation</a> — A<em>B</em>0'
    )
    expect(browser.container.innerHTML).toBe(
      'Hallo Ada, <a class="docs" href="/docs" title="Guide">Dokumentation</a> — A<em>B</em>0'
    )
    browser.cleanup()
  })

  it("keeps repeated tags ordered and renders nested choices", async () => {
    const female: CompiledMessageBranch = (_values, runtime, pluralValue) =>
      runtime.join("Sie hat ", runtime.pound(pluralValue!), " Nachrichten")
    const otherGender: CompiledMessageBranch = (_values, runtime, pluralValue) =>
      runtime.join("Sie haben ", runtime.pound(pluralValue!), " Nachrichten")
    const one: CompiledMessageBranch = (_values, runtime) => runtime.join("Eine Nachricht")
    const many: CompiledMessageBranch = (values, runtime, pluralValue) =>
      runtime.select(values, "gender", { female, other: otherGender }, pluralValue)
    const inbox: CompiledMessage = (values, runtime) =>
      runtime.join(
        runtime.tag("0", runtime.join("Posteingang")),
        ": ",
        runtime.plural(values, "count", 0, "plural", { one, other: many }),
        " / ",
        runtime.tag("0", runtime.join("öffnen"))
      )
    const i18n = createI18n({ locale: "de" })
    i18n.load("de", defineCompiledCatalog({ inbox }))
    setClientI18n(i18n)

    const html = await renderToString(
      createElement(Trans, {
        id: "inbox",
        values: { count: 3, gender: "female" },
        components: { 0: createElement("strong", { class: "label" }) },
      })
    )

    expect(html).toBe(
      '<strong class="label">Posteingang</strong>: Sie hat 3 Nachrichten / <strong class="label">öffnen</strong>'
    )
  })

  it("resets generated tag keys when a cached runtime is reused", () => {
    const i18n = createI18n({ locale: "en" })
    const components = { 0: createElement("strong") }
    const cache = createRemixMessageRuntimeCache()
    const firstRuntime = cache.get(i18n, components)
    const first = firstRuntime.tag("0", firstRuntime.join("one"))[0] as RemixElement
    const secondRuntime = cache.get(i18n, components)
    const second = secondRuntime.tag("0", secondRuntime.join("two"))[0] as RemixElement

    expect(secondRuntime).toBe(firstRuntime)
    expect([first.key, second.key]).toEqual([0, 0])
  })

  it("uses the same readable fallback behavior for missing and malformed messages", async () => {
    const malformed: CompiledMessage = (values, runtime) => runtime.pattern("Hallo {name", values)
    const i18n = createI18n({ locale: "de" })
    i18n.load("de", defineCompiledCatalog({ malformed }))
    setClientI18n(i18n)

    expect(
      await renderToString(
        createElement(Trans, {
          id: "missing",
          message: "Hello {name}",
          values: { name: "Ada" },
        })
      )
    ).toBe("Hello {name}")
    expect(
      await renderToString(
        createElement(Trans, {
          id: "malformed",
          message: "Readable fallback",
          values: { name: "Ada" },
        })
      )
    ).toBe("Readable fallback")
  })

  it("exposes Remix-native macro component types", () => {
    type MacroTransProps = Parameters<typeof MacroTrans>[0]["props"]
    type MacroPluralProps = Parameters<typeof MacroPlural>[0]["props"]
    type MacroSelectProps = Parameters<typeof MacroSelect>[0]["props"]
    type MacroSelectOrdinalProps = Parameters<typeof MacroSelectOrdinal>[0]["props"]

    const trans = {
      children: ["Hello ", createElement("strong", {}, "Ada")],
      components: { 0: createElement("strong") },
    } satisfies MacroTransProps
    const plural = { value: 2, one: "one", other: "other" } satisfies MacroPluralProps
    const select = { value: "female", female: "She", other: "They" } satisfies MacroSelectProps
    const ordinal = { value: 3, one: "first", other: "other" } satisfies MacroSelectOrdinalProps
    const reactOnlyElement = { key: null, props: {}, type: "strong" }

    // @ts-expect-error React-shaped elements do not carry Remix UI's $rmx brand.
    const invalidComponents: NonNullable<TransProps["components"]> = { 0: reactOnlyElement }

    expect([trans, plural, select, ordinal, invalidComponents]).toHaveLength(5)
  })
})
