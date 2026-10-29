import { createI18n, defineCompiledCatalog } from "@palamedes/core";
import { getI18n, resetI18nRuntime } from "@palamedes/runtime";
import { registerMessageLoaderGroup } from "@palamedes/runtime/internal";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  startRemixClient,
  initializeRemixClientI18nAsync,
  type RemixClientDocument,
} from "./client";

describe("Remix client catalog installation", () => {
  afterEach(() => {
    resetI18nRuntime();
    vi.unstubAllGlobals();
  });

  it.each([undefined, "Europe/Berlin"])(
    "installs the document time zone before loading the entry (%s)",
    async (timeZone) => {
      vi.stubGlobal("window", new EventTarget());
      vi.stubGlobal("document", {
        documentElement: { lang: "en", dataset: { palamedesTimeZone: timeZone } },
        body: {},
      });
      const entry = vi.fn(() => {
        expect(getI18n().timeZone).toBe(timeZone);
        return Promise.resolve();
      });
      await startRemixClient(entry, {
        catalogUrl: `data:text/javascript,${encodeURIComponent('export const locale="en",catalogVersion="timezone",fragmentRegistry=true,messages={};')}`,
      });
      expect(entry).toHaveBeenCalledOnce();
    },
  );

  it("loads only the trusted catalog URL and ignores catalog links in the page", async () => {
    vi.stubGlobal("window", new EventTarget());
    // Injected markup can place a look-alike catalog link before the real one.
    const forgedLink = {
      href: `data:text/javascript,${encodeURIComponent('globalThis.forgedCatalogLoaded=true;export const locale="en",catalogVersion="forged",fragmentRegistry=true,messages={};')}`,
      dataset: { palamedesCatalogLocale: "en" },
    };
    const lookup = vi.fn(() => forgedLink);
    vi.stubGlobal("document", {
      documentElement: { lang: "en", dataset: {} },
      body: {},
      querySelector: lookup,
      querySelectorAll: vi.fn(() => [forgedLink]),
    });
    await startRemixClient(async () => {}, {
      catalogUrl: `data:text/javascript,${encodeURIComponent('export const locale="en",catalogVersion="trusted",fragmentRegistry=true,messages={};')}`,
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(Reflect.get(globalThis, "forgedCatalogLoaded")).toBeUndefined();
    expect(getI18n().locale).toBe("en");
  });

  it("renders the error UI instead of a blank page when no trusted catalog URL is given", async () => {
    vi.stubGlobal("window", new EventTarget());
    const replaceChildren = vi.fn();
    vi.stubGlobal("document", {
      documentElement: { lang: "en", dataset: {} },
      body: { replaceChildren },
      querySelector: () => null,
      createElement: () => ({ innerHTML: "", content: { cloneNode: () => ({}) } }),
    });
    const entry = vi.fn(async () => {});
    // JavaScript hosts can omit the option; the bootstrap passes undefined without a locale.
    await startRemixClient(entry, { catalogUrl: undefined as unknown as string });
    expect(entry).not.toHaveBeenCalled();
    expect(replaceChildren).toHaveBeenCalledOnce();
  });

  it("renders a dependency failure once when both its event and startup reject", async () => {
    const browser = new EventTarget();
    const replaceChildren = vi.fn();
    vi.stubGlobal("window", browser);
    vi.stubGlobal("document", {
      documentElement: { lang: "en" },
      body: { replaceChildren },
      querySelector: () => null,
      createElement: () => ({ innerHTML: "", content: { cloneNode: () => ({}) } }),
    });
    await startRemixClient(
      async () => {
        browser.dispatchEvent(new Event("palamedes:catalog-error"));
        throw new Error("entry failed");
      },
      {
        catalogUrl: `data:text/javascript,${encodeURIComponent('export const locale="en",catalogVersion="failure-idempotency",fragmentRegistry=true,messages={};')}`,
      },
    );
    expect(replaceChildren).toHaveBeenCalledTimes(1);
  });

  it("installs an explicit catalog module for custom document and CSP integrations", async () => {
    vi.stubGlobal("window", {});

    await initializeRemixClientI18nAsync({
      createI18n,
      catalog: {
        locale: "en",
        catalogVersion: "deployment-42",
        messages: defineCompiledCatalog({ greeting: "Hello" }),
      },
    });

    expect(getI18n()._("greeting")).toBe("Hello");
  });

  it("loads an executable catalog module before browser modules execute", async () => {
    vi.stubGlobal("window", {});

    await initializeRemixClientI18nAsync({
      createI18n,
      document: createDocument("de"),
      loadCatalog: async () => ({
        locale: "de",
        catalogVersion: "de-v2",
        messages: defineCompiledCatalog({ greeting: "Hallo" }),
      }),
    });

    expect(getI18n()._("greeting")).toBe("Hallo");
  });

  it("fails a missing executable catalog with an actionable asset diagnostic", async () => {
    vi.stubGlobal("window", {});

    await expect(
      initializeRemixClientI18nAsync({
        createI18n,
        document: createDocument("en"),
        loadCatalog: async () => ({ locale: "en", catalogVersion: "v1", messages: {} }),
      }),
    ).rejects.toThrow(/executable catalog asset.*compiled catalog/u);
  });

  it("retries a failed lazy catalog sidecar after its network error recovers", async () => {
    vi.stubGlobal("window", {});
    let attempts = 0;
    const release = registerMessageLoaderGroup("remix-recovery", [
      {
        async de() {
          attempts += 1;
          if (attempts === 1) {
            throw new Error("temporary catalog network failure");
          }
          return defineCompiledCatalog({ greeting: "Hallo nach Recovery" });
        },
      },
    ]);
    const options = {
      createI18n,
      document: createDocument("de"),
      catalog: {
        locale: "de" as const,
        catalogVersion: "de-v2",
        messages: defineCompiledCatalog({}),
      },
    };

    await expect(initializeRemixClientI18nAsync(options)).rejects.toThrow(
      /temporary catalog network failure/u,
    );
    await expect(initializeRemixClientI18nAsync(options)).resolves.toBe(getI18n());
    expect(getI18n()._("greeting")).toBe("Hallo nach Recovery");
    expect(attempts).toBe(2);
    release();
  });

  it("rejects catalog installation in a server environment", async () => {
    await expect(
      initializeRemixClientI18nAsync({
        createI18n,
        catalog: catalogModule("en", "deployment-42", "Hello"),
      }),
    ).rejects.toThrow(/can only run in a browser environment/u);

    vi.stubGlobal("window", {});
    expect(() => getI18n()).toThrow(/No active client i18n instance/u);
  });

  it("supports locale changes through a fresh full document", async () => {
    vi.stubGlobal("window", {});

    await initializeRemixClientI18nAsync({
      createI18n,
      document: createDocument("en"),
      catalog: catalogModule("en", "en-v1", "Hello"),
    });
    expect(getI18n()._("greeting")).toBe("Hello");

    resetI18nRuntime();
    await initializeRemixClientI18nAsync({
      createI18n,
      document: createDocument("de"),
      catalog: catalogModule("de", "de-v1", "Hallo"),
    });
    expect(getI18n()._("greeting")).toBe("Hallo");
  });

  it("requires a full navigation instead of replacing a catalog in one document", async () => {
    vi.stubGlobal("window", {});
    const document = createDocument("en");
    await initializeRemixClientI18nAsync({
      createI18n,
      document,
      catalog: catalogModule("en", "en-v1", "Hello"),
    });

    await expect(
      initializeRemixClientI18nAsync({
        createI18n,
        document,
        catalog: catalogModule("en", "en-v2", "Hello again"),
      }),
    ).rejects.toThrow(/cannot replace catalog.*full document navigation/u);
    expect(getI18n()._("greeting")).toBe("Hello");
  });

  it("rejects an SSR document and catalog locale mismatch before installation", async () => {
    vi.stubGlobal("window", {});

    await expect(
      initializeRemixClientI18nAsync({
        createI18n,
        document: createDocument("en"),
        catalog: catalogModule("de", "de-v1", "Hallo"),
      }),
    ).rejects.toThrow(/locale "de" does not match document locale "en".*full document navigation/u);
    expect(() => getI18n()).toThrow(/No active client i18n instance/u);
  });

  it("reports the missing html lang attribute before installation", async () => {
    vi.stubGlobal("window", {});

    await expect(
      initializeRemixClientI18nAsync({
        createI18n,
        document: createDocument(""),
        catalog: catalogModule("en", "en-v1", "Hello"),
      }),
    ).rejects.toThrow(/no <html lang> attribute.*Render <html lang=\{locale\}>/u);
    expect(() => getI18n()).toThrow(/No active client i18n instance/u);
  });

  it("wraps incompatible clients with an actionable diagnostic", async () => {
    vi.stubGlobal("window", {});

    await expect(
      initializeRemixClientI18nAsync({
        createI18n: () => ({
          locale: "",
          _: () => "",
          load() {
            throw new TypeError("incompatible");
          },
          activate() {},
          getMessage: () => "",
          getMessageNodes: () => [],
          renderMessage<TResult>() {
            throw new Error("renderMessage is not available in this test double");
          },
          reportError() {},
        }),
        catalog: catalogModule("en", "v1", "Hello"),
      }),
    ).rejects.toThrow(/could not install compiled catalog "v1" for locale "en"/u);
    expect(() => getI18n()).toThrow(/No active client i18n instance/u);
  });
});

function catalogModule(locale: string, catalogVersion: string, greeting: string) {
  return { locale, catalogVersion, messages: defineCompiledCatalog({ greeting }) };
}

function createDocument(locale: string): RemixClientDocument {
  return { documentElement: { lang: locale } };
}
