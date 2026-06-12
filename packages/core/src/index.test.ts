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

  it("resolves descriptor ids through the active catalog", () => {
    const i18n = createI18n()

    i18n.load("de", {
      "inbox.summary": "{count, plural, one {# Nachricht} other {# Nachrichten}} fuer {name}",
    })
    i18n.activate("de")

    expect(
      i18n._(
        { id: "inbox.summary", message: "{count, plural, one {# message} other {# messages}} for {name}" },
        { count: 2, name: "Ada" }
      )
    ).toBe("2 Nachrichten fuer Ada")
  })

  it("falls back to the descriptor message when its active catalog is missing", () => {
    const i18n = createI18n()
    i18n.activate("de")

    expect(
      i18n._(
        { id: "inbox.summary", message: "{count, plural, one {# message} other {# messages}} for {name}" },
        { count: 1, name: "Ada" }
      )
    ).toBe("1 message for Ada")
  })

  it("keeps descriptors without ids message-only", () => {
    const i18n = createI18n()

    i18n.load("de", {
      "{name}": "Ada aus dem Katalog",
    })
    i18n.activate("de")

    expect(i18n._({ message: "{name}" }, { name: "Inline" })).toBe("Inline")
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
