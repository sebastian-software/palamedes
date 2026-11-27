import { describe, expect, it } from "vitest";

import {
  formatMessageArgument,
  replacePoundPlaceholders,
  selectPluralCategory,
} from "./runtimeFormat";

describe("formatter reuse", () => {
  it("keeps locale and style changes isolated when alternating number formats", () => {
    const styles = [
      ["integer", { maximumFractionDigits: 0 }],
      ["percent", { style: "percent" }],
      ["::currency/EUR", { style: "currency", currency: "EUR" }],
      [undefined, {}],
    ] as const;
    for (const locale of ["en", "de", "ar", "en"]) {
      for (const [style, options] of styles) {
        const expected = new Intl.NumberFormat(locale, options).format(1234.5);
        expect(formatMessageArgument("number", 1234.5, style, locale)).toBe(expected);
        expect(formatMessageArgument("number", "1234.5", style, locale)).toBe(expected);
      }
    }
  });

  it("separates cardinal and ordinal rules across locale changes", () => {
    for (const locale of ["en", "fr", "ar", "en"]) {
      for (const kind of ["plural", "selectordinal", "plural"] as const) {
        const rules = new Intl.PluralRules(locale, {
          type: kind === "plural" ? "cardinal" : "ordinal",
        });
        for (const value of [0, 1, 2, 3, 11, 21, 1.5]) {
          expect(selectPluralCategory(value, locale, kind)).toBe(rules.select(value));
        }
      }
    }
  });

  it("does not poison the last valid formatter after construction fails", () => {
    const expected = formatMessageArgument("number", 1234.5, "integer", "en");
    expect(() => formatMessageArgument("number", 1234.5, "integer", "!invalid")).toThrow(
      RangeError,
    );
    expect(formatMessageArgument("number", 1234.5, "integer", "en")).toBe(expected);
    const category = selectPluralCategory(2, "en", "selectordinal");
    expect(() => selectPluralCategory(2, "!invalid", "selectordinal")).toThrow(RangeError);
    expect(selectPluralCategory(2, "en", "selectordinal")).toBe(category);
  });

  it("short-circuits replacePoundPlaceholders when no # placeholder is present", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Intl.NumberFormat.prototype, "format")!;
    let formatReads = 0;
    Object.defineProperty(Intl.NumberFormat.prototype, "format", {
      ...descriptor,
      get() {
        formatReads += 1;
        return descriptor.get!.call(this);
      },
    });
    try {
      expect(replacePoundPlaceholders("One item", 1, "!invalid")).toBe("One item");
      expect(replacePoundPlaceholders("One item", 1, "en-US")).toBe("One item");
      expect(formatReads).toBe(0);
      expect(replacePoundPlaceholders("# items", 1234, "en-US")).toBe("1,234 items");
      expect(formatReads).toBe(1);
    } finally {
      Object.defineProperty(Intl.NumberFormat.prototype, "format", descriptor);
    }
  });
});
