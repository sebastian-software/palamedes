/* @jsxImportSource @solidjs/web */
import { renderToString } from "@solidjs/web";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createI18n,
  defineCompiledCatalog,
  MissingCompiledMessageError,
  type CompiledMessage,
} from "@palamedes/core";
import {
  createI18n as createCompiledI18n,
  defineCompiledCatalog as defineParserFreeCatalog,
  type CompiledMessage as ParserFreeMessage,
} from "@palamedes/core/compiled";
import { resetI18nRuntime, setClientI18n, setServerI18nGetter } from "@palamedes/runtime";
import { createServerI18nScope } from "@palamedes/runtime/server";

import { Trans, buildLocaleSwitchItems } from "./index";
import { Trans as CompiledTrans } from "./compiled";
import { compileTestMessages } from "../../../scripts/test-support/compiled-messages.mjs";

import { createSolidMessageRuntime, type TransProps } from "./transShared";

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

  it("looks messages up by id and never by the diagnostic message", () => {
    const i18n = createI18n();
    i18n.load(
      "en",
      defineCompiledCatalog({ "compiled-key": "Compiled", "Source text": "Source lookup" }),
    );
    setServerI18nGetter(() => i18n);

    expect(renderToString(() => <Trans id="compiled-key" message="Source text" />)).toBe(
      "Compiled",
    );
    // Untyped callers cannot fall back to the source message as a lookup key.
    const withoutId = { message: "Source text" } as unknown as TransProps;
    expect(() => renderToString(() => <Trans {...withoutId} />)).toThrow(
      MissingCompiledMessageError,
    );
  });

  it("requires the compiled id in runtime Trans props", () => {
    // @ts-expect-error The transform injects `id`; `message` is diagnostic metadata only.
    const props: TransProps = { message: "Hello" };
    // @ts-expect-error The compiled runtime Trans cannot be authored without `id`.
    const element = () => <Trans message="Hello" />;
    expect([props, typeof element]).toEqual([{ message: "Hello" }, "function"]);
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

  it("renders concurrent mixed-locale SSR requests each in their own locale", async () => {
    const greetings: Record<string, string> = { de: "Hallo", en: "Hello", es: "Hola" };
    const instances = Object.fromEntries(
      Object.entries(greetings).map(([locale, greeting]) => {
        const i18n = createI18n({ locale, timeZone: "UTC" });
        i18n.load(
          locale,
          defineCompiledCatalog(
            compileTestMessages({ greeting: `${greeting} {name}`, footer: `footer-${locale}` }),
          ),
        );
        i18n.activate(locale);
        return [locale, i18n];
      }),
    );
    // One scope for the whole process, the way the adapter guides create it.
    const scope = createServerI18nScope<ReturnType<typeof createI18n>>();

    // Every request parks here after entering its scope, so all of them are
    // in flight, with their own locale, before any of them renders.
    let arrivals = 0;
    let release!: () => void;
    const allInFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requests = ["de", "en", "es", "de", "en", "es"];

    async function handle(locale: string, name: string): Promise<string> {
      return await scope.run(instances[locale]!, async () => {
        arrivals += 1;
        if (arrivals === requests.length) release();
        await allInFlight;
        await new Promise((resolve) => setImmediate(resolve));
        return withoutHydrationMarkers(
          renderToString(() => (
            <p>
              <Trans id="greeting" values={{ name }} />|<CompiledTrans id="footer" />
            </p>
          )),
        );
      });
    }

    const html = await Promise.all(requests.map((locale, index) => handle(locale, `#${index}`)));

    html.forEach((rendered, index) => {
      const locale = requests[index]!;
      expect(rendered).toBe(`<p>${greetings[locale]} #${index}|footer-${locale}</p>`);
    });
  });
});
