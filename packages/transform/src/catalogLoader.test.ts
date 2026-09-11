import { describe, expect, it } from "vitest";

import { createI18n, defineCompiledCatalog } from "@palamedes/core";
import { renderCatalogModule as renderNativeCatalogModule } from "@palamedes/core-node";

import {
  createCatalogLoaderResult,
  createCompileErrorMessage,
  createDiagnosticMessage,
  createMissingErrorMessage,
  renderCatalogModule,
  type CatalogCompileArtifactResult,
} from "./catalogLoader";

const baseResult: CatalogCompileArtifactResult = {
  messages: {
    greeting: "Hallo",
  },
  missing: [],
  diagnostics: [],
};

describe("catalog loader helpers", () => {
  it("delegates module rendering to the canonical native generator", () => {
    const messages = {
      greeting: "Hallo {name}",
      inbox: "{count, plural, one {# Nachricht} other {# Nachrichten}}",
    };

    expect(renderCatalogModule(messages)).toBe(renderNativeCatalogModule(messages));
  });

  it("renders catalog modules consistently", () => {
    expect(renderCatalogModule({ greeting: "Hallo" })).toBe(
      'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";export const messages=__palamedesDefineCompiledCatalog({["greeting"]:"Hallo"});export default { messages };',
    );
  });

  it("rejects invalid and unsupported patterns instead of emitting lazy parser calls", () => {
    expect(() =>
      renderCatalogModule({
        greeting: "Hallo {name}",
        broken: "Hallo {name",
        unsupported: "{items, list, other {Items}}",
      }),
    ).toThrow(/cannot be lowered to the parser-free runtime/);
  });

  it("hoists plural branches instead of allocating them during rendering", () => {
    expect(
      renderCatalogModule({
        inbox: "{count, plural, one {# Nachricht} other {# Nachrichten}}",
      }),
    ).toBe(
      'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";const __pb0=(v,r,p)=>r.join(r.pound(p)," Nachricht");const __pb1=(v,r,p)=>r.join(r.pound(p)," Nachrichten");const __pc0={["one"]:__pb0,["other"]:__pb1};const __pm0=(v,r)=>r.plural(v,"count",0,"plural",__pc0);export const messages=__palamedesDefineCompiledCatalog({["inbox"]:__pm0});export default { messages };',
    );
  });

  it("executes the emitted module through the Core runtime", async () => {
    const globalKey = "__palamedesTestDefineCompiledCatalog";
    Object.defineProperty(globalThis, globalKey, {
      configurable: true,
      value: defineCompiledCatalog,
    });
    const patterns = {
      plain: "Willkommen",
      greeting: "Hallo {name}",
      inbox: "{count, plural, one {# Nachricht} other {# Nachrichten}}",
      hashSelect: "{gender, select, other {# Profil}}",
      nestedSelect: "{count, plural, other {{gender, select, other {# Profile}}}}",
      formatted: "Summe: {amount, number, ::currency/EUR}",
      quoted: "Literal '{name}', Wert: {name}",
      rich: "Hallo <strong>{name}</strong>",
      offset: "{count, plural, offset:1 one {eins} other {# weitere}}",
      ordinal: "{count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}",
    };
    const code = renderCatalogModule(patterns)
      .replace(
        'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";',
        `const __palamedesDefineCompiledCatalog=globalThis.${globalKey};`,
      )
      .replace("export const messages=", "const messages=")
      .replace("export default { messages };", "export default messages;");

    try {
      const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
      const module = (await import(url)) as {
        default: Parameters<ReturnType<typeof createI18n>["load"]>[1];
      };
      const i18n = createI18n({ locale: "de" });
      i18n.load("de", module.default);

      expect(i18n._("plain")).toBe("Willkommen");
      expect(i18n._("greeting", { name: "Ada" })).toBe("Hallo Ada");
      expect(i18n._("inbox", { count: 2 })).toBe("2 Nachrichten");
      expect(i18n._("hashSelect", { gender: "other" })).toBe("# Profil");
      expect(i18n._("nestedSelect", { count: 2, gender: "other" })).toBe("2 Profile");
      expect(i18n._("formatted", { amount: 12.3 })).toBe("Summe: 12,30\u00a0€");
      expect(i18n._("quoted", { name: "Ada" })).toBe("Literal {name}, Wert: Ada");
      expect(i18n._("rich", { name: "Ada" })).toBe("Hallo Ada");
      expect(i18n._("offset", { count: 4 })).toBe("3 weitere");
      expect(i18n._("ordinal", { count: 3 })).toBe("3th");
    } finally {
      delete (globalThis as Record<string, unknown>)[globalKey];
    }
  });

  it("formats missing translations with context", () => {
    expect(
      createMissingErrorMessage("de", [
        { sourceKey: { message: "Hello" } },
        { sourceKey: { message: "Open", context: "verb" } },
      ]),
    ).toBe(
      "Failed to compile catalog for locale de!\n\nMissing 2 translation(s):\nHello\nOpen [context: verb]",
    );
  });

  it("formats diagnostics and compile errors with the same source key rendering", () => {
    const diagnostics = [
      {
        severity: "error" as const,
        code: "icu",
        message: "Broken ICU",
        sourceKey: { message: "Inbox", context: "nav" },
        locale: "de",
      },
    ];

    expect(createDiagnosticMessage("de", diagnostics)).toBe(
      "Catalog diagnostics for locale de:\n\n[error] icu (de)\nBroken ICU\nSource: Inbox [context: nav]",
    );
    expect(createCompileErrorMessage("de", diagnostics)).toBe(
      "Failed to compile catalog for locale de!\n\nCompilation error for 1 translation(s):\nBroken ICU\nCode: icu\nLocale: de\nSource: Inbox [context: nav]",
    );
  });

  it("fails missing translations outside the pseudo locale only when configured", () => {
    const result: CatalogCompileArtifactResult = {
      ...baseResult,
      missing: [{ sourceKey: { message: "Hello" } }],
    };

    expect(() =>
      createCatalogLoaderResult(result, {
        locale: "de",
        failOnMissing: true,
        missingFailureHint: "configured failOnMissing",
      }),
    ).toThrow(/configured failOnMissing/);

    expect(
      createCatalogLoaderResult(result, {
        locale: "de",
        failOnMissing: false,
      }).code,
    ).toBe(renderCatalogModule(baseResult.messages));

    expect(
      createCatalogLoaderResult(result, {
        locale: "pseudo",
        pseudoLocale: "pseudo",
        failOnMissing: true,
      }).code,
    ).toBe(renderCatalogModule(baseResult.messages));
  });

  it("always fails compile diagnostics and explains the removed opt-out", () => {
    const result: CatalogCompileArtifactResult = {
      ...baseResult,
      diagnostics: [
        {
          severity: "error",
          code: "icu",
          message: "Broken ICU",
          sourceKey: { message: "Inbox" },
          locale: "de",
        },
      ],
    };

    expect(() =>
      createCatalogLoaderResult(result, {
        locale: "de",
        failOnCompileError: false,
      }),
    ).toThrow(/failOnCompileError no longer changes this behavior/);

    expect(() =>
      createCatalogLoaderResult(result, {
        locale: "de",
      }),
    ).toThrow(/Failed to compile catalog for locale de/);
  });

  it("reports invalid fallback diagnostics before a missing translation failure", () => {
    const result: CatalogCompileArtifactResult = {
      ...baseResult,
      missing: [{ sourceKey: { message: "Broken {name" } }],
      diagnostics: [
        {
          severity: "error",
          code: "compile.invalid_icu_message",
          message: "Expected ',' at line 1, column 13",
          sourceKey: { message: "Broken {name" },
          locale: "en",
        },
      ],
    };

    expect(() =>
      createCatalogLoaderResult(result, {
        locale: "de",
        failOnMissing: true,
        failOnCompileError: false,
        missingFailureHint: "missing hint",
      }),
    ).toThrow(/compile\.invalid_icu_message[\s\S]*Locale: en[\s\S]*failOnCompileError/);
  });

  it("omits compile failure guidance when warning diagnostics do not fail the build", () => {
    const result: CatalogCompileArtifactResult = {
      ...baseResult,
      diagnostics: [
        {
          severity: "warning",
          code: "icu",
          message: "Suspicious ICU",
          sourceKey: { message: "Inbox" },
          locale: "de",
        },
      ],
    };

    expect(
      createCatalogLoaderResult(result, {
        locale: "de",
      }).warnings,
    ).toStrictEqual([
      "Catalog diagnostics for locale de:\n\n[warning] icu (de)\nSuspicious ICU\nSource: Inbox",
    ]);
  });
});
