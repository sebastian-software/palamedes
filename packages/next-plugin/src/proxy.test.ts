import { describe, expect, it } from "vitest";

import { PALAMEDES_LOCALE_HEADER, setRequestLocale } from "./proxy";

describe("setRequestLocale", () => {
  it("returns request headers with the locale and overwrites a client-supplied value", () => {
    const incoming = new Headers({ accept: "text/html", [PALAMEDES_LOCALE_HEADER]: "fr" });
    const headers = setRequestLocale(incoming, "de");
    expect(headers.get(PALAMEDES_LOCALE_HEADER)).toBe("de");
    expect(headers.get("accept")).toBe("text/html");
    expect(incoming.get(PALAMEDES_LOCALE_HEADER)).toBe("fr");
  });
});
