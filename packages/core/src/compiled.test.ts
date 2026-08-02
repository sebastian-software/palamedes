import { describe, expect, it, vi } from "vitest"

import {
  createI18n,
  defineCompiledCatalog,
  type CompiledCatalogMessages,
  type CompiledMessage,
  type CompiledMessageBranch,
} from "./compiled"

describe("parser-free compiled runtime", () => {
  it("renders generated constants, variables, and plurals without parsing ICU", () => {
    const greeting: CompiledMessage = (values, runtime) =>
      runtime.join("Hallo ", runtime.value(values, "name"))
    const one: CompiledMessageBranch = (_values, runtime) => runtime.join("eine Nachricht")
    const other: CompiledMessageBranch = (_values, runtime, pluralValue) =>
      runtime.join(runtime.pound(pluralValue!), " Nachrichten")
    const inbox: CompiledMessage = (values, runtime) =>
      runtime.plural(values, "count", 0, "plural", { one, other })

    const i18n = createI18n({ locale: "de" })
    i18n.load(
      "de",
      defineCompiledCatalog({
        plain: "Willkommen",
        greeting,
        inbox,
      })
    )

    expect(i18n._("plain")).toBe("Willkommen")
    expect(i18n._("greeting", { name: "Ada" })).toBe("Hallo Ada")
    expect(i18n._("inbox", { count: 2 })).toBe("2 Nachrichten")
  })

  it("rejects hand-written string catalogs at the load boundary", () => {
    const i18n = createI18n()

    expect(() =>
      i18n.load("de", { greeting: "Hallo {name}" } as unknown as CompiledCatalogMessages)
    ).toThrow(/only accepts generated CompiledCatalogMessages/)
  })

  it("reports lazy-pattern calls and degrades to the source fallback", () => {
    const onError = vi.fn()
    const lazy: CompiledMessage = (values, runtime) => runtime.pattern("Hallo {name}", values)
    const i18n = createI18n({ locale: "de", onError })
    i18n.load("de", defineCompiledCatalog({ lazy }))

    expect(i18n._("lazy", { name: "Ada" }, { message: "Hello {name}" })).toBe("Hello {name}")
    expect(onError).toHaveBeenCalledOnce()
  })
})
