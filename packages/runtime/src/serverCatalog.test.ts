import { afterEach, describe, expect, it, vi } from "vitest";

import { createI18n, defineCompiledCatalog, type CompiledCatalogMessages } from "@palamedes/core";

import { createServerCatalogStore } from "./serverCatalog";

describe("createServerCatalogStore", () => {
  afterEach(() => vi.restoreAllMocks());

  it("loads only requested locales and shares concurrent and warmed catalogs", async () => {
    const load = vi.fn(async ({ locale }: { locale: "de" | "en" }) => [
      defineCompiledCatalog({ greeting: locale === "de" ? "Hallo" : "Hello" }),
    ]);
    const store = createServerCatalogStore({ load });

    const first = store.load("de");
    const second = store.load("de");
    expect(first).toBe(second);
    const catalog = await first;

    expect(await store.load("de")).toBe(catalog);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith({ locale: "de", generation: 0 });
    expect(store.getReady("de")).toBe(catalog);
    expect(store.getReady("en")).toBeUndefined();
    expect(store.stats()).toStrictEqual({
      trackedLocales: 1,
      readyLocales: 1,
      inFlightLocales: 0,
      retainedFragments: 1,
      retainedMessages: 1,
    });
  });

  it("prepares ordered fragments once and applies later overrides", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = defineCompiledCatalog({ greeting: "Hello", shared: "base" });
    const override = defineCompiledCatalog({ shared: "override", extra: "Extra" });
    const store = createServerCatalogStore({ load: async () => [base, override] });

    const catalog = await store.load("en");
    expect(Object.entries(catalog)).toStrictEqual([
      ["greeting", "Hello"],
      ["shared", "override"],
      ["extra", "Extra"],
    ]);
    expect(Object.isFrozen(catalog)).toBe(true);
    expect(store.stats()).toMatchObject({ retainedFragments: 2, retainedMessages: 3 });
    expect(await store.load("en")).toBe(catalog);
  });

  describe("duplicate message IDs across fragments", () => {
    it("warns once per ID when fragments disagree and keeps the last value", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = createServerCatalogStore({
        load: async () => [
          defineCompiledCatalog({ shared: "base", same: "same" }),
          defineCompiledCatalog({ shared: "override", same: "same" }),
          defineCompiledCatalog({ shared: "again" }),
        ],
      });

      const catalog = await store.load("en");
      store.invalidate("en");
      await store.load("en");

      expect(catalog).toMatchObject({ shared: "again", same: "same" });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('"shared"');
    });

    it("stays silent for identical strings and equivalent compiled functions", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const compiled = () => ((values: Record<string, unknown>) => String(values["name"])) as never;
      const store = createServerCatalogStore({
        load: async () => [
          defineCompiledCatalog({ text: "Hello", fn: compiled() }),
          defineCompiledCatalog({ text: "Hello", fn: compiled() }),
        ],
      });

      await store.load("en");

      expect(warn).not.toHaveBeenCalled();
    });
  });

  it("rejects uncompiled loader fragments before retaining them", async () => {
    const store = createServerCatalogStore({
      load: async () => [{ greeting: "Hello" } as unknown as CompiledCatalogMessages],
    });

    await expect(store.load("en")).rejects.toThrow(/generated compiled catalogs/);
    expect(store.getReady("en")).toBeUndefined();
    expect(store.stats()).toMatchObject({ readyLocales: 0, inFlightLocales: 0 });
  });

  it("lets independent request runtimes share the catalog without sharing request state", async () => {
    const greeting = defineCompiledCatalog({ greeting: "Hallo" });
    const store = createServerCatalogStore({ load: async () => [greeting] });
    const messages = await store.load("de");
    const otherMessages = await store.load("de");
    const first = createI18n({ locale: "de", timeZone: "UTC" });
    const second = createI18n({ locale: "de", timeZone: "Europe/Berlin" });

    first.load("de", messages);
    second.load("de", otherMessages);
    first.activate("de");
    second.activate("de");

    expect(otherMessages).toBe(messages);
    expect(first._("greeting")).toBe("Hallo");
    expect(second._("greeting")).toBe("Hallo");
    expect(first.timeZone).toBe("UTC");
    expect(second.timeZone).toBe("Europe/Berlin");
  });

  it("evicts failures so the next request can retry", async () => {
    const firstFailure = new Error("catalog unavailable");
    const load = vi
      .fn()
      .mockRejectedValueOnce(firstFailure)
      .mockResolvedValueOnce([defineCompiledCatalog({ greeting: "Hello" })]);
    const store = createServerCatalogStore({ load });

    const first = store.load("en");
    expect(store.load("en")).toBe(first);
    await expect(first).rejects.toBe(firstFailure);
    expect(store.getReady("en")).toBeUndefined();

    const retry = await store.load("en");
    expect(retry.greeting).toBe("Hello");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not retain locales the loader rejects as unsupported", async () => {
    // Mirrors the generated server-catalogs modules: the loader, not the
    // store, knows which locales exist.
    const loaders: Record<string, () => Promise<CompiledCatalogMessages[]>> = {
      en: async () => [defineCompiledCatalog({ greeting: "Hello" })],
    };
    const load = vi.fn(({ locale }: { locale: string }) => {
      if (!Object.hasOwn(loaders, locale)) throw new Error("Unsupported catalog locale");
      return loaders[locale]!();
    });
    const store = createServerCatalogStore({ load });
    const english = await store.load("en");
    const before = store.stats();
    expect(before.trackedLocales).toBe(1);

    const unknown = Array.from({ length: 50 }, (_, index) => `xx-${index}`);
    const results = await Promise.allSettled(unknown.map((locale) => store.load(locale)));
    for (const result of results) {
      expect(result).toMatchObject({
        status: "rejected",
        reason: expect.objectContaining({ message: "Unsupported catalog locale" }),
      });
    }

    expect(store.stats()).toStrictEqual(before);
    for (const locale of unknown) {
      expect(store.getReady(locale)).toBeUndefined();
      expect(store.generation(locale)).toBe(0);
      store.invalidate(locale);
    }
    expect(store.stats()).toStrictEqual(before);
    expect(await store.load("en")).toBe(english);
  });

  it("shares one in-flight rejection for concurrent loads of an unknown locale", async () => {
    const load = vi.fn(async () => {
      throw new Error("Unsupported catalog locale");
    });
    const store = createServerCatalogStore({ load });

    const first = store.load("xx");
    expect(store.load("xx")).toBe(first);
    expect(store.stats()).toMatchObject({ trackedLocales: 1, inFlightLocales: 1 });
    await expect(first).rejects.toThrow("Unsupported catalog locale");
    expect(load).toHaveBeenCalledOnce();
    expect(store.stats()).toMatchObject({ trackedLocales: 0, inFlightLocales: 0 });
  });

  it("does not let an old generation overwrite a newer invalidation", async () => {
    let releaseOld: ((catalogs: readonly CompiledCatalogMessages[]) => void) | undefined;
    let releaseNew: ((catalogs: readonly CompiledCatalogMessages[]) => void) | undefined;
    const old = new Promise<readonly CompiledCatalogMessages[]>((resolve) => {
      releaseOld = resolve;
    });
    const newer = new Promise<readonly CompiledCatalogMessages[]>((resolve) => {
      releaseNew = resolve;
    });
    const load = vi.fn(({ generation }: { generation: number }) =>
      generation === 0 ? old : newer,
    );
    const store = createServerCatalogStore({ load });

    const oldRequest = store.load("de");
    store.invalidate("de");
    expect(store.generation("de")).toBe(1);
    const newRequest = store.load("de");
    await Promise.resolve();
    await Promise.resolve();
    expect(load).toHaveBeenNthCalledWith(1, { locale: "de", generation: 0 });
    expect(load).toHaveBeenNthCalledWith(2, { locale: "de", generation: 1 });

    const newCatalog = defineCompiledCatalog({ greeting: "Neu" });
    releaseNew!([newCatalog]);
    const newResult = await newRequest;
    expect(store.getReady("de")).toBe(newResult);

    const oldCatalog = defineCompiledCatalog({ greeting: "Alt" });
    releaseOld!([oldCatalog]);
    const oldResult = await oldRequest;
    expect(oldResult.greeting).toBe("Alt");
    expect(store.getReady("de")).toBe(newResult);
    expect(store.getReady("de")?.greeting).toBe("Neu");
  });

  it("invalidates all retained locales without starting a load", async () => {
    const load = vi.fn(
      async ({ locale, generation }: { locale: "de" | "en"; generation: number }) => [
        defineCompiledCatalog({ greeting: `${locale}-${generation}` }),
      ],
    );
    const store = createServerCatalogStore({ load });
    await Promise.all([store.load("de"), store.load("en")]);

    store.invalidate();
    expect(store.getReady("de")).toBeUndefined();
    expect(store.getReady("en")).toBeUndefined();
    expect(store.generation("de")).toBe(1);
    expect(store.generation("en")).toBe(1);
    expect(store.stats()).toMatchObject({ readyLocales: 0, inFlightLocales: 0 });
    expect(load).toHaveBeenCalledTimes(2);
  });
});
