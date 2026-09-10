import { describe, expect, it, vi } from "vitest";

import { createLocaleFormatterCache } from "./localeFormatterCache";

describe("locale formatter cache", () => {
  it("reuses every format while alternating styles and locales", () => {
    const create = vi.fn((locale: string | undefined, style: string | undefined) => ({
      locale,
      style,
    }));
    const get = createLocaleFormatterCache(create);
    const first = get("en", "currency");
    const second = get("en", "percent");
    const german = get("de", "currency");
    for (let index = 0; index < 10; index += 1) {
      expect(get("en", "currency")).toBe(first);
      expect(get("en", "percent")).toBe(second);
      expect(get("de", "currency")).toBe(german);
    }
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("bounds total formatters across locale buckets, including the active bucket", () => {
    const create = vi.fn((locale: string | undefined, style: string) => ({ locale, style }));
    const get = createLocaleFormatterCache(create, 3);
    const oldest = get("en", "a");
    const german = get("de", "a");
    const newestEnglish = get("en", "b");
    expect(get("en", "a")).toBe(oldest); // Reads do not change FIFO eviction.
    const french = get("fr", "a");
    expect(get("de", "a")).toBe(german);
    expect(get("en", "b")).toBe(newestEnglish);
    expect(get("fr", "a")).toBe(french);
    expect(get("en", "a")).not.toBe(oldest);
    expect(create).toHaveBeenCalledTimes(5);
    expect(get("de", "a")).not.toBe(german); // Recreate an emptied locale bucket.
    expect(create).toHaveBeenCalledTimes(6);
  });

  it("evicts correctly when all entries belong to one locale", () => {
    const get = createLocaleFormatterCache((_locale, key: number) => ({ key }), 2);
    const oldest = get("en", 0);
    const retained = get("en", 1);
    get("en", 2);
    expect(get("en", 1)).toBe(retained);
    expect(get("en", 0)).not.toBe(oldest);
  });

  it("keeps undefined keys and property-like style names distinct", () => {
    const get = createLocaleFormatterCache((locale, key: string | undefined) => ({ locale, key }));
    const defaultLocale = get(undefined, undefined);
    const emptyLocale = get("", undefined);
    const emptyStyle = get(undefined, "");
    expect(emptyLocale).not.toBe(defaultLocale);
    expect(emptyStyle).not.toBe(defaultLocale);
    const prototype = get(undefined, "__proto__");
    get("de", "constructor");
    expect(get(undefined, "__proto__")).toBe(prototype);
    expect(get(undefined, undefined)).toBe(defaultLocale);
  });

  it("does not evict a valid formatter when construction throws", () => {
    const get = createLocaleFormatterCache((locale, key: string) => {
      if (locale === "invalid") throw new RangeError("invalid locale");
      return { locale, key };
    }, 1);
    const retained = get("en", "currency");
    expect(() => get("invalid", "currency")).toThrow(RangeError);
    expect(get("en", "currency")).toBe(retained);
  });
});
