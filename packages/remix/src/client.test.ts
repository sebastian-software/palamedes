import { createI18n, defineCompiledCatalog } from "@palamedes/core";
import { getI18n, resetI18nRuntime } from "@palamedes/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  initializeRemixClientI18n,
  readRemixI18nBootstrap,
  REMIX_I18N_BOOTSTRAP_ID,
  type RemixI18nBootstrapDocument,
} from "./client";

describe("Remix client i18n bootstrap", () => {
  afterEach(() => {
    resetI18nRuntime();
    vi.unstubAllGlobals();
  });

  it("rejects inert document catalogs until the Remix asset pipeline is used", () => {
    vi.stubGlobal("window", {});
    const document = createBootstrapDocument("de", {
      locale: "de",
      catalogVersion: "catalog-de-v1",
      messages: { greeting: "Hallo {name}" },
    });

    expect(() => initializeRemixClientI18n({ createI18n, document })).toThrow(
      /inert serialized ICU catalog.*asset pipeline.*#1214/u,
    );
    expect(() => getI18n()).toThrow(/No active client i18n instance/u);
  });

  it("supports an explicit payload for custom document and CSP integrations", () => {
    vi.stubGlobal("window", {});

    initializeRemixClientI18n({
      createI18n,
      bootstrap: {
        locale: "en",
        catalogVersion: "deployment-42",
        messages: defineCompiledCatalog({ greeting: "Hello" }),
      },
    });

    expect(getI18n()._("greeting")).toBe("Hello");
  });

  it("rejects explicit bootstrap in a server environment before installation", () => {
    expect(() =>
      initializeRemixClientI18n({
        createI18n,
        bootstrap: {
          locale: "en",
          catalogVersion: "deployment-42",
          messages: { greeting: "Hello" },
        },
      }),
    ).toThrow(/can only run in a browser environment.*createRemixI18nServer/u);

    vi.stubGlobal("window", {});
    expect(() => getI18n()).toThrow(/No active client i18n instance/u);
  });

  it("supports locale changes through a fresh full-document bootstrap", () => {
    vi.stubGlobal("window", {});

    initializeRemixClientI18n({
      createI18n,
      document: createBootstrapDocument("en", undefined),
      bootstrap: {
        locale: "en",
        catalogVersion: "en-v1",
        messages: defineCompiledCatalog({ greeting: "Hello" }),
      },
    });
    expect(getI18n()._("greeting")).toBe("Hello");

    resetI18nRuntime();
    initializeRemixClientI18n({
      createI18n,
      document: createBootstrapDocument("de", undefined),
      bootstrap: {
        locale: "de",
        catalogVersion: "de-v1",
        messages: defineCompiledCatalog({ greeting: "Hallo" }),
      },
    });
    expect(getI18n()._("greeting")).toBe("Hallo");
  });

  it("requires a full navigation instead of replacing a catalog in one document", () => {
    vi.stubGlobal("window", {});
    const document = createBootstrapDocument("en", undefined);
    initializeRemixClientI18n({
      createI18n,
      document,
      bootstrap: {
        locale: "en",
        catalogVersion: "en-v1",
        messages: defineCompiledCatalog({ greeting: "Hello" }),
      },
    });

    expect(() =>
      initializeRemixClientI18n({
        createI18n,
        document,
        bootstrap: {
          locale: "en",
          catalogVersion: "en-v2",
          messages: defineCompiledCatalog({ greeting: "Hello again" }),
        },
      }),
    ).toThrow(/cannot replace catalog.*full document navigation/u);
    expect(getI18n()._("greeting")).toBe("Hello");
  });

  it("rejects missing, malformed, and non-string catalog payloads", () => {
    vi.stubGlobal("window", {});

    expect(() =>
      readRemixI18nBootstrap({ document: createBootstrapDocument("en", undefined) }),
    ).toThrow(/could not find a <template/u);

    expect(() =>
      readRemixI18nBootstrap({ document: createBootstrapDocument("en", "{broken") }),
    ).toThrow(/not valid JSON/u);

    expect(() =>
      initializeRemixClientI18n({
        createI18n,
        bootstrap: {
          locale: "en",
          catalogVersion: "v1",
          messages: { greeting: { executable: true } },
        },
      }),
    ).toThrow(/message "greeting" must be an ICU string/u);
  });

  it("rejects an SSR document and catalog locale mismatch before installation", () => {
    vi.stubGlobal("window", {});
    const document = createBootstrapDocument("en", {
      locale: "de",
      catalogVersion: "de-v1",
      messages: { greeting: "Hallo" },
    });

    expect(() => initializeRemixClientI18n({ createI18n, document })).toThrow(
      /locale "de" does not match document locale "en".*full document navigation/u,
    );
    expect(() => getI18n()).toThrow(/No active client i18n instance/u);
  });

  it("reports the missing html lang attribute before installation", () => {
    vi.stubGlobal("window", {});
    const document = createBootstrapDocument("", {
      locale: "en",
      catalogVersion: "en-v1",
      messages: { greeting: "Hello" },
    });

    expect(() => initializeRemixClientI18n({ createI18n, document })).toThrow(
      /no <html lang> attribute.*Render <html lang=\{locale\}>/u,
    );
    expect(() => getI18n()).toThrow(/No active client i18n instance/u);
  });

  it("wraps incompatible parser-free clients with an actionable diagnostic", () => {
    vi.stubGlobal("window", {});

    expect(() =>
      initializeRemixClientI18n({
        createI18n: () => ({
          locale: "",
          _: () => "",
          load() {
            throw new TypeError("parser-free");
          },
          activate() {},
          getMessage: () => "",
          getMessageNodes: () => [],
          renderMessage<TResult>() {
            throw new Error("renderMessage is not available in this test double");
          },
          reportError() {},
        }),
        bootstrap: {
          locale: "en",
          catalogVersion: "v1",
          messages: { greeting: "Hello" },
        },
      }),
    ).toThrow(/inert serialized ICU catalog.*#1214/u);
    expect(() => getI18n()).toThrow(/No active client i18n instance/u);
  });
});

function createBootstrapDocument(locale: string, payload: unknown): RemixI18nBootstrapDocument {
  return {
    documentElement: { lang: locale },
    getElementById(id) {
      if (id !== REMIX_I18N_BOOTSTRAP_ID || payload === undefined) {
        return null;
      }
      return {
        content: {
          textContent: typeof payload === "string" ? payload : JSON.stringify(payload),
        },
      };
    },
  };
}
