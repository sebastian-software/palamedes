import { afterEach, describe, expect, it, vi } from "vitest";

import { defineCompiledCatalog } from "@palamedes/core";

const loadServerCatalog = vi.fn(async (locale: string) => {
  if (locale === "fr") throw new Error("Unsupported catalog locale");
  return defineCompiledCatalog({ greeting: locale === "de" ? "Hallo" : "Hello" });
});

vi.mock(
  "virtual:palamedes/server-catalogs",
  () => ({ loadServerCatalog }),
  // @ts-expect-error virtual module option is supported by the test runner.
  { virtual: true },
);

describe("createBundledServerI18n", () => {
  afterEach(() => loadServerCatalog.mockClear());

  it("loads only the selected generated catalog into a fresh instance", async () => {
    const { createBundledServerI18n } = await import("./server-bundled");

    const [de, en] = await Promise.all([
      createBundledServerI18n({ locale: "de", timeZone: "Europe/Berlin" }),
      createBundledServerI18n({ locale: "en", timeZone: "UTC" }),
    ]);

    expect(loadServerCatalog.mock.calls).toEqual([["de"], ["en"]]);
    expect(de).not.toBe(en);
    expect([de.locale, de.timeZone, de._("greeting")]).toEqual(["de", "Europe/Berlin", "Hallo"]);
    expect([en.locale, en.timeZone, en._("greeting")]).toEqual(["en", "UTC", "Hello"]);
  });

  it("propagates catalog failures instead of falling back to source text", async () => {
    const { createBundledServerI18n } = await import("./server-bundled");

    await expect(createBundledServerI18n({ locale: "fr" })).rejects.toThrow(
      "Unsupported catalog locale",
    );
  });
});
