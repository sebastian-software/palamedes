import { describe, expect, expectTypeOf, it, vi } from "vitest"

import {
  createI18n,
  DEFAULT_LOCALE,
  defineCompiledCatalog,
  type CompiledMessage,
  type CompiledMessageBranch,
} from "./index"

describe("createI18n", () => {
  it("starts with the default locale as a non-optional string", () => {
    const i18n = createI18n()

    expect(DEFAULT_LOCALE).toBe("en")
    expect(i18n.locale).toBe(DEFAULT_LOCALE)
    expectTypeOf(i18n.locale).toEqualTypeOf<string>()
    expectTypeOf(i18n.timeZone).toEqualTypeOf<string | undefined>()
  })

  it("uses the configured time zone for ICU date/time output without sharing formatters", () => {
    const when = new Date(Date.UTC(2026, 5, 12, 1, 45, 0))
    const losAngeles = createI18n({ locale: "en-US", timeZone: "America/Los_Angeles" })
    const tokyo = createI18n({ locale: "en-US", timeZone: "Asia/Tokyo" })

    expect(losAngeles.timeZone).toBe("America/Los_Angeles")
    expect(losAngeles._("Due {when, date, full}; {when, time, short}", { when })).toBe(
      `Due ${new Intl.DateTimeFormat("en-US", {
        dateStyle: "full",
        timeZone: "America/Los_Angeles",
      }).format(when)}; ${new Intl.DateTimeFormat("en-US", {
        timeStyle: "short",
        timeZone: "America/Los_Angeles",
      }).format(when)}`
    )
    expect(tokyo._("Due {when, date, full}; {when, time, short}", { when })).toBe(
      `Due ${new Intl.DateTimeFormat("en-US", {
        dateStyle: "full",
        timeZone: "Asia/Tokyo",
      }).format(when)}; ${new Intl.DateTimeFormat("en-US", {
        timeStyle: "short",
        timeZone: "Asia/Tokyo",
      }).format(when)}`
    )
  })

  it("rejects invalid configured time zones before rendering", () => {
    expect(() => createI18n({ timeZone: "Mars/Olympus_Mons" })).toThrow(RangeError)
    expect(() => createI18n({ timeZone: "" })).toThrow(RangeError)
  })

  it("reports missing messages with the default locale before catalogs load", () => {
    const onMissing = vi.fn()
    const i18n = createI18n({ onMissing })

    expect(i18n._("missing-key", {}, { message: "Fallback" })).toBe("Fallback")
    expect(onMissing).toHaveBeenCalledWith({
      id: "missing-key",
      locale: DEFAULT_LOCALE,
      metadata: { message: "Fallback" },
    })
  })

  it("uses the initial locale for catalogs, source fallback, and missing-message telemetry", () => {
    const onMissing = vi.fn()
    const i18n = createI18n({ locale: "de", onMissing })
    i18n.load("de", { greeting: "Hallo" })

    expect(i18n._("greeting")).toBe("Hallo")

    expect(
      i18n._(
        "inbox.summary",
        { count: 2 },
        { message: "{count, plural, one {# Nachricht} other {# Nachrichten}}" }
      )
    ).toBe("2 Nachrichten")
    expect(onMissing).toHaveBeenCalledWith({
      id: "inbox.summary",
      locale: "de",
      metadata: {
        message: "{count, plural, one {# Nachricht} other {# Nachrichten}}",
      },
    })
  })

  it("loads messages, activates a locale, and resolves simple lookups", () => {
    const i18n = createI18n()

    i18n.load("de", {
      greeting: "Hallo {name}",
    })
    i18n.activate("de")

    expect(i18n.locale).toBe("de")
    expect(i18n._("greeting", { name: "Ada" })).toBe("Hallo Ada")
  })

  it("parses raw patterns without re-entering catalog lookup", () => {
    const i18n = createI18n({ locale: "de" })
    i18n.load("de", {
      "Hello {name}": "Falscher Katalogtreffer",
    })

    expect(i18n.parsePattern?.("Hello {name}")).toStrictEqual([
      { type: "text", value: "Hello " },
      { type: "variable", name: "name" },
    ])
  })

  it("executes generated functions while keeping constants as strings", () => {
    const greeting: CompiledMessage = (values, runtime) =>
      runtime.join("Hallo ", runtime.value(values, "name"))
    const messages = defineCompiledCatalog({
      greeting,
      plain: "Nur Text",
    })
    const i18n = createI18n({ locale: "de" })

    expect(messages.greeting).toBe(greeting)
    expect(messages.plain).toBe("Nur Text")
    expect(JSON.stringify(messages)).toBe('{"plain":"Nur Text"}')

    i18n.load("de", messages)

    expect(i18n._("greeting", { name: "Ada" })).toBe("Hallo Ada")
    expect(i18n._("plain")).toBe("Nur Text")
    expect(i18n.getMessage("greeting")).toBe("Hallo {name}")
    expect(i18n.getMessageNodes("greeting")).toStrictEqual([
      { type: "text", value: "Hallo " },
      { type: "variable", name: "name" },
    ])
    expect(i18n.getMessageNodes("plain")).toStrictEqual([{ type: "text", value: "Nur Text" }])
  })

  it("keeps lazy parsing for generated entries that could not compile", () => {
    const onError = vi.fn()
    const broken: CompiledMessage = (values, runtime) => runtime.pattern("Hallo {name", values)
    const messages = defineCompiledCatalog({ broken })
    const i18n = createI18n({ locale: "de", onError })
    i18n.load("de", messages)

    expect(i18n._("broken", {}, { message: "Hello" })).toBe("Hello")
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0].pattern).toBe("Hallo {name")
  })

  it("executes compiled plural branches and reconstructs their public pattern", () => {
    const one: CompiledMessageBranch = (_values, runtime, pluralValue) =>
      runtime.join(runtime.pound(pluralValue!), " Nachricht")
    const other: CompiledMessageBranch = (_values, runtime, pluralValue) =>
      runtime.join(runtime.pound(pluralValue!), " Nachrichten")
    const branches = { one, other }
    const inbox: CompiledMessage = (values, runtime) =>
      runtime.plural(values, "count", 0, "plural", branches)
    const i18n = createI18n({ locale: "de" })
    i18n.load("de", defineCompiledCatalog({ inbox }))

    expect(i18n._("inbox", { count: 1 })).toBe("1 Nachricht")
    expect(i18n._("inbox", { count: 2 })).toBe("2 Nachrichten")
    expect(i18n.getMessage("inbox")).toBe(
      "{count, plural, one {# Nachricht} other {# Nachrichten}}"
    )
    expect(i18n.getMessageNodes("inbox")).toEqual([
      {
        type: "choice",
        variable: "count",
        kind: "plural",
        options: {
          one: [{ type: "text", value: "# Nachricht" }],
          other: [{ type: "text", value: "# Nachrichten" }],
        },
      },
    ])
  })

  it("drops a stale compiled function when a later string catalog overrides an id", () => {
    const onError = vi.fn()
    const i18n = createI18n({ locale: "de", onError })
    const greeting: CompiledMessage = (values, runtime) =>
      runtime.join("Hallo ", runtime.value(values, "name"))
    i18n.load("de", defineCompiledCatalog({ greeting }))

    i18n.load("de", { greeting: "Defekt {name" })

    expect(i18n._("greeting", { name: "Ada" }, { message: "Hello {name}" })).toBe("Hello Ada")
    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0].pattern).toBe("Defekt {name")
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
    const errors: Array<{ id?: string; locale: string; pattern: string; fallback: string }> = []
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

  it("routes adapter render failures through onError with the active locale", () => {
    const onError = vi.fn()
    const i18n = createI18n({ onError })
    i18n.activate("de")

    i18n.reportError({
      id: "items",
      error: "not an Error instance",
      pattern: "{n, plural, other {# Dateien}}",
      fallback: "{n} files",
      metadata: { message: "{n} files" },
    })

    expect(onError).toHaveBeenCalledOnce()
    expect(onError.mock.calls[0]?.[0]).toMatchObject({
      id: "items",
      locale: "de",
      pattern: "{n, plural, other {# Dateien}}",
      fallback: "{n} files",
    })
    expect(onError.mock.calls[0]?.[0].error).toBeInstanceOf(Error)
    expect(onError.mock.calls[0]?.[0].error.message).toBe("not an Error instance")
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
