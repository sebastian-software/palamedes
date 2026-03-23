import { describe, expect, it } from "vitest"

import { createI18n } from "./index"

describe("createI18n", () => {
  it("loads messages, activates a locale, and resolves simple lookups", () => {
    const i18n = createI18n()

    i18n.load("de", {
      greeting: "Hallo {name}",
    })
    i18n.activate("de")

    expect(i18n.locale).toBe("de")
    expect(i18n._("greeting", { name: "Ada" })).toBe("Hallo Ada")
  })

  it("falls back to the descriptor message when the compiled catalog is missing a key", () => {
    const i18n = createI18n()
    i18n.activate("en")

    expect(i18n._("missing-key", { count: 2 }, { message: "{count, plural, one {# file} other {# files}}" })).toBe(
      "2 files"
    )
  })

  it("formats select and selectordinal messages", () => {
    const i18n = createI18n()
    i18n.activate("en")

    expect(
      i18n._("gendered", { gender: "female" }, { message: "{gender, select, male {He} female {She} other {They}}" })
    ).toBe("She")
    expect(
      i18n._("ordinal", { count: 3 }, { message: "{count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}" })
    ).toBe("3rd")
  })
})
