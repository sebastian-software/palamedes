import { describe, expect, it } from "vitest";

import { resolveLocaleFromRequest } from "./i18n.server";

describe("route request locale policy", () => {
  it("uses the locale path for document requests", () => {
    expect(resolveLocaleFromRequest(new Request("https://example.test/de"))).toBe("de");
  });

  it("inherits a locale for same-origin server-function requests", () => {
    expect(
      resolveLocaleFromRequest(
        new Request("https://example.test/_serverFn", {
          headers: { referer: "https://example.test/de" },
        }),
      ),
    ).toBe("de");
  });

  it("accepts only validated explicit locale headers", () => {
    expect(
      resolveLocaleFromRequest(
        new Request("https://example.test/_serverFn", {
          headers: { "x-palamedes-locale": "de" },
        }),
      ),
    ).toBe("de");
    expect(
      resolveLocaleFromRequest(
        new Request("https://example.test/_serverFn", {
          headers: {
            "x-palamedes-locale": "de",
            referer: "https://attacker.example/de",
          },
        }),
      ),
    ).toBe("de");
  });

  it("ignores cross-origin and invalid locale context", () => {
    expect(
      resolveLocaleFromRequest(
        new Request("https://example.test/_serverFn", {
          headers: { referer: "https://attacker.example/de" },
        }),
      ),
    ).toBe("en");
    expect(
      resolveLocaleFromRequest(
        new Request("https://example.test/_serverFn", {
          headers: { "x-palamedes-locale": "../../de" },
        }),
      ),
    ).toBe("en");
  });
});
