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

  it("falls back to the descriptor message when its active catalog lacks the id", () => {
    const i18n = createI18n()

    i18n.load("de", {
      "other.message": "Andere Nachricht",
    })
    i18n.activate("de")

    expect(
      i18n._(
        { id: "inbox.summary", message: "{count, plural, one {# message} other {# messages}} for {name}" },
        { count: 2, name: "Ada" }
      )
    ).toBe("2 messages for Ada")
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

  it("formats ICU number arguments with locale-aware styles", () => {
    const i18n = createI18n()
    i18n.activate("en-US")

    expect(i18n._({ message: "Total: {amount, number, ::currency/EUR}" }, { amount: 12.3 })).toBe(
      `Total: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(12.3)}`
    )
    expect(i18n._({ message: "Progress: {ratio, number, percent}" }, { ratio: 0.42 })).toBe(
      `Progress: ${new Intl.NumberFormat("en-US", { style: "percent" }).format(0.42)}`
    )
    expect(i18n._({ message: "Rounded: {count, number, integer}" }, { count: 12.8 })).toBe(
      `Rounded: ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(12.8)}`
    )
  })

  it("stringifies invalid ICU number arguments instead of formatting them as zero", () => {
    const i18n = createI18n()
    i18n.activate("en-US")

    expect(i18n._({ message: "Total: {amount, number, ::currency/EUR}" }, {})).toBe("Total: ")
    expect(i18n._({ message: "Total: {amount, number, ::currency/EUR}" }, { amount: Number.NaN })).toBe("Total: NaN")
    expect(i18n._({ message: "Total: {amount, number, ::currency/EUR}" }, { amount: Number.POSITIVE_INFINITY })).toBe(
      "Total: Infinity"
    )
  })

  it("formats ICU date and time arguments with locale-aware styles", () => {
    const i18n = createI18n()
    i18n.activate("en-US")
    const when = new Date(Date.UTC(2026, 5, 12, 13, 45, 0))

    expect(i18n._({ message: "Due {when, date, medium}" }, { when })).toBe(
      `Due ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(when)}`
    )
    expect(i18n._({ message: "Starts {when, time, short}" }, { when })).toBe(
      `Starts ${new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(when)}`
    )
    expect(i18n._({ message: "Starts {when, time}" }, { when })).toBe(
      `Starts ${new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(when)}`
    )
  })
})
