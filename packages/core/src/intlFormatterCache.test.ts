import { describe, expect, it, vi } from "vitest";

import {
  createIntlFormatterCache,
  DATE_TIME_FORMAT_KEYS,
  NUMBER_FORMAT_KEYS,
} from "./intlFormatterCache";

describe("Intl options cache", () => {
  it("reuses equivalent options regardless of property order without retaining mutable input", () => {
    const create = vi.fn(
      (locale, options: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options),
    );
    const get = createIntlFormatterCache(create, NUMBER_FORMAT_KEYS);
    const mutableOptions: Intl.NumberFormatOptions = { style: "currency", currency: "EUR" };
    const euro = get("en", mutableOptions);
    expect(get("en", { currency: "EUR", style: "currency", useGrouping: undefined })).toBe(euro);
    mutableOptions.currency = "JPY";
    expect(get("en", mutableOptions).format(12.34)).toBe("¥12");
    expect(euro.format(12.34)).toBe("€12.34");
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("bounds retained formatters to 64 across options and locales", () => {
    const create = vi.fn(
      (locale, options: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options),
    );
    const get = createIntlFormatterCache(create, NUMBER_FORMAT_KEYS);
    const oldest = get("en", { minimumFractionDigits: 0 });
    for (const locale of ["en", "de", "fr", "ja"]) {
      for (let minimumFractionDigits = 0; minimumFractionDigits < 16; minimumFractionDigits += 1) {
        get(locale, { minimumFractionDigits });
      }
    }
    expect(create).toHaveBeenCalledTimes(64);
    expect(get("en", {})).not.toBe(oldest);
    expect(get("en", { minimumFractionDigits: 0 })).not.toBe(oldest);
    expect(create).toHaveBeenCalledTimes(66);
  });

  it("does not conflate invalid or coercible untyped options with cached JSON values", () => {
    const get = createIntlFormatterCache(
      (locale, options: Intl.NumberFormatOptions) => new Intl.NumberFormat(locale, options),
      NUMBER_FORMAT_KEYS,
    );
    const nullOptions = { minimumFractionDigits: null } as unknown as Intl.NumberFormatOptions;
    expect(get("en", nullOptions).format(1)).toBe("1");
    expect(() => get("en", { minimumFractionDigits: Number.NaN })).toThrow(RangeError);
    expect(() => get("en", { minimumFractionDigits: Infinity })).toThrow(RangeError);
    expect(
      get("en", {
        currency: { toString: () => "EUR", toJSON: () => "JPY" },
        style: "currency",
      } as unknown as Intl.NumberFormatOptions).format(1),
    ).toBe("€1.00");
  });

  it("isolates every date option and reuses valid entries after an invalid constructor call", () => {
    const create = vi.fn(
      (locale, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, options),
    );
    const get = createIntlFormatterCache(create, DATE_TIME_FORMAT_KEYS);
    const retained = get("en", { dateStyle: "medium", timeZone: "UTC" });
    expect(get("en", { timeZone: "UTC", dateStyle: "medium" })).toBe(retained);
    expect(get("en", { dateStyle: "medium", timeZone: "Asia/Tokyo" })).not.toBe(retained);
    expect(() => get("en", { dateStyle: "medium", year: "numeric" })).toThrow(TypeError);
    expect(get("en", { dateStyle: "medium", timeZone: "UTC" })).toBe(retained);
    expect(create).toHaveBeenCalledTimes(3);
  });
});
