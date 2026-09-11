/* @jsxImportSource @solidjs/web */
import { renderToString } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createI18n, defineCompiledCatalog, type CompiledMessage } from "@palamedes/core";
import {
  createI18n as createCompiledI18n,
  defineCompiledCatalog as defineParserFreeCatalog,
  type CompiledMessage as ParserFreeMessage,
} from "@palamedes/core/compiled";
import { resetI18nRuntime, setClientI18n, setServerI18nGetter } from "@palamedes/runtime";

import { Trans, buildLocaleSwitchItems } from "./index";
import { Trans as CompiledTrans } from "./compiled";
import { compileTestMessages } from "../../../scripts/test-support/compiled-messages.mjs";

import { createSolidMessageRuntime } from "./transShared";

function withoutHydrationMarkers(html: string): string {
  return html.replaceAll("<!--!$-->", "");
}

describe("@palamedes/solid", () => {
  afterEach(() => {
    resetI18nRuntime();
    delete (globalThis as { window?: unknown }).window;
  });
  it("joins parts without mutating input arrays and preserves sparse-array behavior", () => {
    const runtime = createSolidMessageRuntime(createI18n(), {});
    const parts = ["first", "second"];
    Object.freeze(parts);
    const sparse: string[] = [];
    sparse.length = 2;
    sparse[1] = "tail";
    expect(runtime.join("", parts, sparse)).toEqual(["", "first", "second", "tail"]);
    expect(parts).toEqual(["first", "second"]);
  });

  it("renders Trans without a provider by reading the active runtime instance", () => {
    const i18n = createI18n();
    i18n.load("de", defineCompiledCatalog({ footer: "Bereitgestellt von Palamedes" }));
    i18n.activate("de");
    setServerI18nGetter(() => i18n);

    const html = renderToString(() => <Trans id="footer" message="Powered by Palamedes" />);

    expect(html).toBe("Bereitgestellt von Palamedes");
  });

  it("executes generated message functions directly through the Solid renderer", () => {
    const footer: CompiledMessage = (values, runtime) =>
      runtime.join(
        "Hallo ",
        runtime.value(values, "name"),
        ", ",
        runtime.tag("0", runtime.join("willkommen")),
      );
    const i18n = createI18n({ locale: "de" });
    i18n.load("de", defineCompiledCatalog({ footer }));
    setServerI18nGetter(() => i18n);

    const html = renderToString(() => (
      <Trans
        id="footer"
        message="Hello {name}, <0>welcome</0>"
        values={{ name: "Ada" }}
        components={{ 0: (props) => <strong>{props.children}</strong> }}
      />
    ));

    expect(withoutHydrationMarkers(html)).toBe("Hallo Ada, <strong>willkommen</strong>");
  });

  it("renders generated messages through the parser-free production entry", () => {
    const greeting: ParserFreeMessage = (values, runtime) =>
      runtime.join("Hallo ", runtime.value(values, "name"));
    const i18n = createCompiledI18n({ locale: "de" });
    i18n.load("de", defineParserFreeCatalog({ greeting }));
    setServerI18nGetter(() => i18n);

    const html = renderToString(() => <CompiledTrans id="greeting" values={{ name: "Ada" }} />);

    expect(withoutHydrationMarkers(html)).toBe("Hallo Ada");
  });

  it("builds locale switch items headlessly", () => {
    expect(
      buildLocaleSwitchItems({
        currentLocale: "de",
        labels: {
          de: "Deutsch",
          en: "English",
        },
        locales: ["en", "de"] as const,
      }),
    ).toStrictEqual([
      { active: false, label: "English", locale: "en", testId: "locale-switch-en" },
      { active: true, label: "Deutsch", locale: "de", testId: "locale-switch-de" },
    ]);
  });
  it("renders compiled choices, values, quoted literals, rich text and Intl formatting", () => {
    const i18n = createI18n({ locale: "en-US", timeZone: "UTC" });
    i18n.load(
      "en-US",
      defineCompiledCatalog(
        compileTestMessages({
          plural: "{count, plural, offset:1 one {<0># guest</0>} other {<0># guests</0>}}",
          ordinal: "{count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}",
          select: "{kind, select, mine {Mine} other {Other}}",
          quoted: "Literal '{name}': {name}",
          date: "{when, date, medium}",
          number: "{amount, number, ::currency/EUR}",
        }),
      ),
    );
    setServerI18nGetter(() => i18n);
    for (const Renderer of [Trans, CompiledTrans]) {
      expect(
        withoutHydrationMarkers(
          renderToString(() => (
            <Renderer
              id="plural"
              values={{ count: 3 }}
              components={{ 0: (props) => <strong>{props.children}</strong> }}
            />
          )),
        ),
      ).toBe("<strong>2 guests</strong>");
      expect(
        withoutHydrationMarkers(
          renderToString(() => <Renderer id="ordinal" values={{ count: 3 }} />),
        ),
      ).toBe("3rd");
      expect(
        withoutHydrationMarkers(
          renderToString(() => <Renderer id="select" values={{ kind: "toString" }} />),
        ),
      ).toBe("Other");
      expect(
        withoutHydrationMarkers(
          renderToString(() => <Renderer id="quoted" values={{ name: "Ada" }} />),
        ),
      ).toBe("Literal {name}: Ada");
      expect(
        withoutHydrationMarkers(
          renderToString(() => <Renderer id="date" values={{ when: "2026-06-12" }} />),
        ),
      ).toBe("Jun 12, 2026");
      expect(
        withoutHydrationMarkers(
          renderToString(() => <Renderer id="number" values={{ amount: 12.3 }} />),
        ),
      ).toBe("€12.30");
    }
  });

  it("propagates missing entries and invalid values without rendering source substitutes", () => {
    const onError = vi.fn();
    const i18n = createI18n({ onError });
    i18n.load("en", defineCompiledCatalog(compileTestMessages({ number: "{amount, number}" })));
    setServerI18nGetter(() => i18n);
    for (const Renderer of [Trans, CompiledTrans]) {
      expect(() =>
        renderToString(() => <Renderer id="private-key" message="Source {name}" />),
      ).toThrow(/required compiled message/);
      expect(() =>
        renderToString(() => <Renderer id="number" values={{ amount: "invalid" }} />),
      ).toThrow(/finite numeric/);
    }
    expect(onError).toHaveBeenCalledTimes(2);
  });
});
