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

  it("falls back to source metadata when the compiled catalog is missing a key", () => {
    const i18n = createI18n()
    i18n.activate("en")

    expect(
      i18n._(
        "missing-key",
        { count: 2 },
        { message: "{count, plural, one {# file} other {# files}}" }
      )
    ).toBe("2 files")
  })

  it("resolves compiled ids through the active catalog", () => {
    const i18n = createI18n()

    i18n.load("de", {
      "inbox.summary": "{count, plural, one {# Nachricht} other {# Nachrichten}} fuer {name}",
    })
    i18n.activate("de")

    expect(
      i18n._(
        "inbox.summary",
        { count: 2, name: "Ada" },
        { message: "{count, plural, one {# message} other {# messages}} for {name}" }
      )
    ).toBe("2 Nachrichten fuer Ada")
  })

  it("falls back to source metadata when its active catalog is missing", () => {
    const i18n = createI18n()
    i18n.activate("de")

    expect(
      i18n._(
        "inbox.summary",
        { count: 1, name: "Ada" },
        { message: "{count, plural, one {# message} other {# messages}} for {name}" }
      )
    ).toBe("1 message for Ada")
  })

  it("falls back to source metadata when its active catalog lacks the id", () => {
    const i18n = createI18n()

    i18n.load("de", {
      "other.message": "Andere Nachricht",
    })
    i18n.activate("de")

    expect(
      i18n._(
        "inbox.summary",
        { count: 2, name: "Ada" },
        { message: "{count, plural, one {# message} other {# messages}} for {name}" }
      )
    ).toBe("2 messages for Ada")
  })

  it("reports missing catalog messages when an active locale is missing an id", () => {
    const missing: Array<{ id: string; locale: string }> = []
    const i18n = createI18n({
      onMissing(info) {
        missing.push({ id: info.id, locale: info.locale })
      },
    })

    i18n.activate("de")

    expect(i18n._("missing-key", {}, { message: "Fallback" })).toBe("Fallback")
    expect(missing).toStrictEqual([{ id: "missing-key", locale: "de" }])
  })

  it("does not report missing messages for loaded empty-string translations", () => {
    const missing: string[] = []
    const i18n = createI18n({
      onMissing(info) {
        missing.push(info.id)
      },
    })

    i18n.load("de", {
      intentionallyEmpty: "",
    })
    i18n.activate("de")

    expect(i18n._("intentionallyEmpty", {}, { message: "Fallback" })).toBe("")
    expect(missing).toStrictEqual([])
  })

  it("reports malformed catalog patterns and falls back to the formatted source message", () => {
    const errors: Array<{ id?: string; locale?: string; pattern: string; fallback: string }> = []
    const i18n = createI18n({
      onError(info) {
        errors.push({
          id: info.id,
          locale: info.locale,
          pattern: info.pattern,
          fallback: info.fallback,
        })
      },
    })

    i18n.load("de", {
      "broken.message": "{count, plural one {# Datei} other {# Dateien}}",
    })
    i18n.activate("de")

    expect(
      i18n._(
        "broken.message",
        { count: 2 },
        { message: "{count, plural, one {# file} other {# files}}" }
      )
    ).toBe("2 files")
    expect(errors).toStrictEqual([
      {
        id: "broken.message",
        locale: "de",
        pattern: "{count, plural one {# Datei} other {# Dateien}}",
        fallback: "{count, plural, one {# file} other {# files}}",
      },
    ])
  })

  it("returns the raw source message when the source pattern is malformed", () => {
    const errors: string[] = []
    const i18n = createI18n({
      onError(info) {
        errors.push(info.pattern)
      },
    })

    expect(i18n._("{count, plural one {# file} other {# files}}", { count: 2 })).toBe(
      "{count, plural one {# file} other {# files}}"
    )
    expect(errors).toStrictEqual(["{count, plural one {# file} other {# files}}"])
  })

  it("returns fallback nodes when a catalog pattern is malformed", () => {
    const errors: string[] = []
    const i18n = createI18n({
      onError(info) {
        errors.push(info.pattern)
      },
    })

    i18n.load("de", {
      greeting: "Hallo {name",
    })
    i18n.activate("de")

    expect(i18n.getMessageNodes("greeting", { message: "Hello {name}" })).toStrictEqual([
      { type: "text", value: "Hello " },
      { type: "variable", name: "name" },
    ])
    expect(errors).toStrictEqual(["Hallo {name"])
  })

  it("returns malformed source messages as plain-text nodes", () => {
    const i18n = createI18n()

    expect(i18n.getMessageNodes("{name")).toStrictEqual([{ type: "text", value: "{name" }])
  })

  it("keeps rendering resilient when hooks throw", () => {
    const i18n = createI18n({
      onMissing() {
        throw new Error("missing telemetry failed")
      },
      onError() {
        throw new Error("error telemetry failed")
      },
    })

    i18n.activate("de")

    expect(i18n._("broken", {}, { message: "{name" })).toBe("{name")
  })

  it("formats select and selectordinal messages", () => {
    const i18n = createI18n()
    i18n.activate("en")

    expect(
      i18n._(
        "gendered",
        { gender: "female" },
        { message: "{gender, select, male {He} female {She} other {They}}" }
      )
    ).toBe("She")
    expect(
      i18n._(
        "ordinal",
        { count: 3 },
        { message: "{count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}" }
      )
    ).toBe("3rd")
  })

  it("formats ICU number arguments with locale-aware styles", () => {
    const i18n = createI18n()
    i18n.activate("en-US")

    expect(i18n._("Total: {amount, number, ::currency/EUR}", { amount: 12.3 })).toBe(
      `Total: ${new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR" }).format(12.3)}`
    )
    expect(i18n._("Bare: {amount, number, currency/EUR}", { amount: 12.3 })).toBe(
      `Bare: ${new Intl.NumberFormat("en-US").format(12.3)}`
    )
    expect(i18n._("Progress: {ratio, number, percent}", { ratio: 0.42 })).toBe(
      `Progress: ${new Intl.NumberFormat("en-US", { style: "percent" }).format(0.42)}`
    )
    expect(i18n._("Rounded: {count, number, integer}", { count: 12.8 })).toBe(
      `Rounded: ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(12.8)}`
    )
  })

  it("stringifies invalid ICU number arguments instead of formatting them as zero", () => {
    const i18n = createI18n()
    i18n.activate("en-US")

    expect(i18n._("Total: {amount, number, ::currency/EUR}", {})).toBe("Total: ")
    expect(i18n._("Total: {amount, number, ::currency/EUR}", { amount: Number.NaN })).toBe(
      "Total: NaN"
    )
    expect(
      i18n._("Total: {amount, number, ::currency/EUR}", { amount: Number.POSITIVE_INFINITY })
    ).toBe("Total: Infinity")
  })

  it("formats ICU date and time arguments with locale-aware styles", () => {
    const i18n = createI18n()
    i18n.activate("en-US")
    const when = new Date(Date.UTC(2026, 5, 12, 13, 45, 0))

    expect(i18n._("Due {when, date, medium}", { when })).toBe(
      `Due ${new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(when)}`
    )
    expect(i18n._("Starts {when, time, short}", { when })).toBe(
      `Starts ${new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(when)}`
    )
    expect(i18n._("Starts {when, time}", { when })).toBe(
      `Starts ${new Intl.DateTimeFormat("en-US", { timeStyle: "short" }).format(when)}`
    )
  })
})
