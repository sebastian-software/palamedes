import { describe, expect, it, vi } from "vitest";

import { createI18n, defineCompiledCatalog, type CompiledMessage } from "./index";
import { createI18n as createCompiledI18n } from "./compiled";

describe.each([createI18n, createCompiledI18n])("standalone instance formatting", (create) => {
  it("formats currencies with their own minor units, percent, and compact values without a catalog", () => {
    const i18n = create({ locale: "en-US" });
    expect(i18n.number(1234.56, { style: "currency", currency: "EUR" })).toBe("€1,234.56");
    expect(i18n.number(1234.56, { style: "currency", currency: "JPY" })).toBe("¥1,235");
    expect(i18n.number("1234.56", { style: "currency", currency: "KWD" })).toBe("KWD 1,234.560");
    expect(i18n.number(0.125, { style: "percent", maximumFractionDigits: 1 })).toBe("12.5%");
    expect(i18n.number(12_000, { notation: "compact" })).toBe("12K");
    expect(i18n.number(0)).toBe("0");
  });

  it("uses the active locale and applies per-call overrides without changing the instance", () => {
    const i18n = create({ locale: "en-US", timeZone: "America/Los_Angeles" });
    const when = "2026-11-03T01:00:00Z";
    const options = { dateStyle: "medium", timeStyle: "short" } as const;
    for (const locale of ["en-US", "de-DE", "en-US"]) {
      i18n.activate(locale);
      expect(i18n.number(1234.5)).toBe(new Intl.NumberFormat(locale).format(1234.5));
      expect(i18n.date(when, options)).toBe(
        new Intl.DateTimeFormat(locale, { ...options, timeZone: i18n.timeZone }).format(
          new Date(when),
        ),
      );
      expect(i18n.number(1234.5, { locale: "fr-FR" })).toBe(
        new Intl.NumberFormat("fr-FR").format(1234.5),
      );
      expect(i18n.date(when, { ...options, locale: "fr-FR", timeZone: "Asia/Tokyo" })).toBe(
        new Intl.DateTimeFormat("fr-FR", { ...options, timeZone: "Asia/Tokyo" }).format(
          new Date(when),
        ),
      );
      expect(i18n.locale).toBe(locale);
      expect(i18n.timeZone).toBe("America/Los_Angeles");
    }
  });

  it("distinguishes civil dates from instants in a western time zone", () => {
    const i18n = create({ locale: "en-US", timeZone: "America/Los_Angeles" });
    const options = Object.freeze({
      dateStyle: "medium",
      timeZone: "America/Los_Angeles",
    } as const);
    expect(i18n.date("2026-11-03", options)).toBe("Nov 3, 2026");
    expect(i18n.date("2026-11-03T00:00:00Z", options)).toBe("Nov 2, 2026");
    expect(i18n.date(new Date("2026-11-03"), options)).toBe("Nov 2, 2026");
    expect(i18n.date(Date.parse("2026-11-03"), options)).toBe("Nov 2, 2026");
    expect(i18n.date(0, { timeZone: "UTC" })).toBe("1/1/1970");
  });

  it("matches compiled argument formatting and isolates alternating instances", () => {
    const currency: CompiledMessage = (values, runtime) =>
      runtime.number(values, "amount", "::currency/EUR");
    const date: CompiledMessage = (values, runtime) => runtime.date(values, "when", "medium");
    const time: CompiledMessage = (values, runtime) => runtime.time(values, "when", "short");
    const catalog = defineCompiledCatalog({ currency, date, time });
    const instances = [
      create({ locale: "en-US", timeZone: "America/Los_Angeles" }),
      create({ locale: "en-US", timeZone: "Asia/Tokyo" }),
      create({ locale: "de-DE", timeZone: "Europe/Berlin" }),
    ];
    for (const i18n of instances) i18n.load(i18n.locale, catalog);
    for (const i18n of [...instances, ...[...instances].reverse()]) {
      expect(i18n.number(12.34, { style: "currency", currency: "EUR" })).toBe(
        i18n._("currency", { amount: 12.34 }),
      );
      for (const when of ["2026-11-03", "2026-11-03T01:00:00Z"]) {
        expect(i18n.date(when, { dateStyle: "medium" })).toBe(i18n._("date", { when }));
        expect(i18n.date(when, { timeStyle: "short" })).toBe(i18n._("time", { when }));
      }
    }
  });

  it("uses all number options and observes changes to a reused options object", () => {
    const i18n = create({ locale: "en-US" });
    const mutableOptions: Intl.NumberFormatOptions = { style: "currency", currency: "EUR" };
    expect(i18n.number(1234.56, mutableOptions)).toBe("€1,234.56");
    mutableOptions.currency = "JPY";
    expect(i18n.number(1234.56, mutableOptions)).toBe("¥1,235");
    for (const options of [
      { style: "unit", unit: "kilometer-per-hour", unitDisplay: "long" },
      { minimumFractionDigits: 3, useGrouping: false },
      { notation: "scientific", signDisplay: "always" },
      { maximumSignificantDigits: 2, numberingSystem: "arab" },
    ] satisfies Intl.NumberFormatOptions[]) {
      expect(i18n.number(1234.56, options)).toBe(
        new Intl.NumberFormat(i18n.locale, options).format(1234.56),
      );
    }
    for (const roundingMode of ["floor", "ceil"]) {
      const options = { maximumFractionDigits: 1, roundingMode };
      expect(i18n.number(1234.56, options)).toBe(
        new Intl.NumberFormat(i18n.locale, options).format(1234.56),
      );
    }
  });

  it("uses all date options, including inherited and non-enumerable properties", () => {
    const i18n = create({ locale: "en-US", timeZone: "UTC" });
    const when = new Date("2026-11-03T01:02:03.456Z");
    for (const options of [
      { calendar: "buddhist", year: "numeric", month: "long", day: "numeric" },
      { hour: "numeric", minute: "2-digit", hourCycle: "h23" },
      { hour: "numeric", minute: "2-digit", hour12: true },
      { second: "numeric", fractionalSecondDigits: 3, numberingSystem: "arab" },
      { timeZoneName: "long", weekday: "long", era: "short" },
    ] satisfies Intl.DateTimeFormatOptions[]) {
      expect(i18n.date(when, options)).toBe(
        new Intl.DateTimeFormat(i18n.locale, { ...options, timeZone: "UTC" }).format(when),
      );
    }
    const inherited = Object.create({
      dateStyle: "medium",
      timeZone: "Asia/Tokyo",
    }) as Intl.DateTimeFormatOptions;
    Object.defineProperty(inherited, "timeStyle", { value: "short" });
    expect(i18n.date(when, inherited)).toBe(
      new Intl.DateTimeFormat("en-US", inherited).format(when),
    );
    const currency = Object.create({
      style: "currency",
      currency: "EUR",
    }) as Intl.NumberFormatOptions;
    expect(i18n.number(1234.56, currency)).toBe("€1,234.56");
  });

  it("rejects invalid values consistently with messages and leaves placeholders to callers", () => {
    const onMissing = vi.fn();
    const onError = vi.fn();
    const i18n = create({ onMissing, onError });
    for (const value of [
      null,
      undefined,
      "",
      " ",
      "invalid",
      Number.NaN,
      Infinity,
      -Infinity,
      true,
      1n,
      {},
    ]) {
      expect(() => i18n.number(value as number)).toThrow(TypeError);
    }
    for (const value of [
      null,
      undefined,
      "",
      "invalid",
      Number.NaN,
      Infinity,
      new Date(Number.NaN),
      true,
      {},
    ]) {
      expect(() => i18n.date(value as Date)).toThrow(TypeError);
    }
    expect(() => i18n.number(1, { style: "currency" })).toThrow(TypeError);
    expect(() => i18n.number(1, { maximumFractionDigits: -1 })).toThrow(RangeError);
    expect(() => i18n.number(1, { locale: "!invalid" })).toThrow(RangeError);
    expect(() => i18n.date(0, { timeZone: "invalid-zone" })).toThrow(RangeError);
    expect(() => i18n.date(0, { dateStyle: "medium", year: "numeric" })).toThrow(TypeError);
    expect(onMissing).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(i18n.number(1)).toBe("1");
    expect(i18n.date(0, { timeZone: "UTC" })).toBe("1/1/1970");
  });
});
