// @vitest-environment jsdom
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createI18n, defineCompiledCatalog, type CompiledMessage } from "@palamedes/core";
import {
  createI18n as createCompiledI18n,
  defineCompiledCatalog as defineParserFreeCatalog,
  type CompiledMessage as ParserFreeMessage,
} from "@palamedes/core/compiled";
import { resetI18nRuntime, setClientI18n } from "@palamedes/runtime";

import { Trans, buildLocaleSwitchItems } from "./index";
import { Trans as CompiledTrans } from "./compiled";
import { compileTestMessages } from "../../../scripts/test-support/compiled-messages.mjs";
import { createReactMessageRuntimeCache, createTrans } from "./transShared";

describe("@palamedes/react", () => {
  afterEach(() => {
    resetI18nRuntime();
    vi.unstubAllGlobals();
  });

  it("reuses idle Trans runtimes across component shapes while resetting render state", () => {
    const i18n = createI18n({ locale: "en" });
    const fixtures = defineCompiledCatalog(
      compileTestMessages({
        first: "<0>body</0>",
        second: "<0>body</0>",
        "inline-components": "<0>body</0>",
        "different-shape": "<1>body</1>",
        "new-locale": "<0>body</0>",
      }),
    );
    i18n.load("en", fixtures);
    i18n.load("de", fixtures);
    const renderMessage = vi.spyOn(i18n, "renderMessage");
    const CachedTrans = createTrans(() => i18n);
    const stableComponents = { 0: <strong /> };

    expect(
      renderToStaticMarkup(
        <CachedTrans id="first" message="<0>body</0>" components={stableComponents} />,
      ),
    ).toBe("<strong>body</strong>");
    expect(
      renderToStaticMarkup(
        <CachedTrans id="second" message="<0>body</0>" components={stableComponents} />,
      ),
    ).toBe("<strong>body</strong>");
    expect(renderMessage.mock.calls[1]?.[2]).toBe(renderMessage.mock.calls[0]?.[2]);

    expect(
      renderToStaticMarkup(
        <CachedTrans id="inline-components" message="<0>body</0>" components={{ 0: <em /> }} />,
      ),
    ).toBe("<em>body</em>");
    expect(renderMessage.mock.calls[2]?.[2]).toBe(renderMessage.mock.calls[1]?.[2]);

    renderToStaticMarkup(
      <CachedTrans id="different-shape" message="<1>body</1>" components={{ 1: <strong /> }} />,
    );
    expect(renderMessage.mock.calls[3]?.[2]).toBe(renderMessage.mock.calls[2]?.[2]);

    i18n.activate("de");
    renderToStaticMarkup(
      <CachedTrans id="new-locale" message="<0>body</0>" components={stableComponents} />,
    );
    expect(renderMessage.mock.calls[4]?.[2]).not.toBe(renderMessage.mock.calls[1]?.[2]);

    const runtimeCache = createReactMessageRuntimeCache();
    const firstLease = runtimeCache.acquire(i18n, stableComponents);
    const firstRuntime = firstLease.runtime;
    const firstResult = firstRuntime.tag("0", firstRuntime.join("body"));
    runtimeCache.release(firstLease);
    const secondLease = runtimeCache.acquire(i18n, { 0: <em /> });
    const secondRuntime = secondLease.runtime;
    const secondResult = secondRuntime.tag("0", secondRuntime.join("body"));
    runtimeCache.release(secondLease);
    expect(secondRuntime).toBe(firstRuntime);
    expect(isValidElement(secondResult[0]) && secondResult[0].type).toBe("em");
    expect([
      isValidElement(firstResult[0]) ? firstResult[0].key : null,
      isValidElement(secondResult[0]) ? secondResult[0].key : null,
    ]).toEqual(["0", "0"]);
  });

  it("isolates nested synchronous renders and releases component references afterwards", () => {
    const i18n = createCompiledI18n();
    const outer: ParserFreeMessage = (args, runtime) =>
      runtime.join(
        runtime.tag("0", runtime.join("before")),
        runtime.value(args, "nested"),
        runtime.tag("0", runtime.join("after")),
      );
    const inner: ParserFreeMessage = (_values, runtime) => runtime.tag("0", runtime.join("inside"));
    i18n.load("en", defineParserFreeCatalog({ outer, inner }));
    const NestedTrans = createTrans(() => i18n);
    const renderMessage = vi.spyOn(i18n, "renderMessage");
    const values = {
      get nested() {
        return NestedTrans({ id: "inner", components: { 0: <em /> } });
      },
    };
    expect(
      renderToStaticMarkup(
        <NestedTrans id="outer" values={values} components={{ 0: <strong /> }} />,
      ),
    ).toBe("<strong>before</strong><em>inside</em><strong>after</strong>");
    const outerRuntime = renderMessage.mock.calls[0]![2];
    const innerRuntime = renderMessage.mock.calls[1]![2];
    expect(innerRuntime).not.toBe(outerRuntime);
    expect(outerRuntime.tag("0", outerRuntime.join("released"))).toEqual(["released"]);
    expect(innerRuntime.tag("0", innerRuntime.join("released"))).toEqual(["released"]);
  });

  it("releases a leased renderer when a custom renderMessage throws", () => {
    const i18n = createI18n();
    i18n.load("en", defineCompiledCatalog({ Hello: "Hello" }));
    const renderMessage = vi.spyOn(i18n, "renderMessage").mockImplementationOnce(() => {
      throw new Error("custom renderer failed");
    });
    const CachedTrans = createTrans(() => i18n);
    expect(() => CachedTrans({ message: "Hello", components: { 0: <strong /> } })).toThrow(
      "custom renderer failed",
    );
    CachedTrans({ message: "Hello" });
    const runtime = renderMessage.mock.calls[0]![2];
    expect(renderMessage.mock.calls[1]![2]).toBe(runtime);
    expect(runtime.tag("0", runtime.join("released"))).toEqual(["released"]);
  });

  it("joins parts without mutating inputs or flattening nested React children twice", () => {
    const cache = createReactMessageRuntimeCache();
    const lease = cache.acquire(createI18n(), {});
    const nested = ["nested"];
    const parts: ReactNode[] = ["text", nested];
    Object.freeze(parts);
    const sparse: string[] = [];
    sparse.length = 2;
    sparse[1] = "tail";
    expect(lease.runtime.join("", parts, sparse)).toEqual(["", "text", nested, "tail"]);
    expect(parts).toEqual(["text", nested]);
    cache.release(lease);
  });

  it("executes generated message functions directly through the React renderer", () => {
    const footer: CompiledMessage = (values, runtime) =>
      runtime.join(
        "Hallo ",
        runtime.value(values, "name"),
        ", ",
        runtime.tag("0", runtime.join("willkommen")),
      );
    const i18n = createI18n({ locale: "de" });
    i18n.load("de", defineCompiledCatalog({ footer }));
    setClientI18n(i18n);

    const html = renderToStaticMarkup(
      <Trans
        id="footer"
        message="Hello {name}, <0>welcome</0>"
        values={{ name: "Ada" }}
        components={{ 0: <strong /> }}
      />,
    );

    expect(html).toBe("Hallo Ada, <strong>willkommen</strong>");
  });

  it("renders generated messages through the parser-free production entry", () => {
    const greeting: ParserFreeMessage = (values, runtime) =>
      runtime.join("Hallo ", runtime.value(values, "name"));
    const i18n = createCompiledI18n({ locale: "de" });
    i18n.load("de", defineParserFreeCatalog({ greeting }));
    setClientI18n(i18n);

    expect(
      renderToStaticMarkup(
        <CompiledTrans id="greeting" values={{ name: "Ada" }} components={{}} />,
      ),
    ).toBe("Hallo Ada");
  });

  it("keeps root compat components on generated parser-free catalog entries", () => {
    const greeting: ParserFreeMessage = (values, runtime) =>
      runtime.join("Hallo ", runtime.value(values, "name"));
    const i18n = createCompiledI18n({ locale: "de" });
    i18n.load("de", defineParserFreeCatalog({ greeting }));
    setClientI18n(i18n);

    expect(
      renderToStaticMarkup(<Trans id="greeting" message="Hello {name}" values={{ name: "Ada" }} />),
    ).toBe("Hallo Ada");
  });

  it("uses identical compiled rich, quoted, plural, select, ordinal, and Intl messages through both entries", () => {
    const i18n = createI18n({ locale: "en-US", timeZone: "America/Los_Angeles" });
    i18n.load(
      "en-US",
      defineCompiledCatalog(
        compileTestMessages({
          rich: "Hello <0>{name}</0><1/>",
          quoted: "Literal '{name}', value: {name}",
          plural:
            "{count, plural, offset:1 =0 {Nobody} one {<0># guest</0>} other {<0># guests</0>}}",
          select: "{gender, select, female {She} other {They}}",
          ordinal: "{count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}",
          number: "{amount, number, ::currency/EUR}",
          when: "{when, date, full} {when, time, short}",
        }),
      ),
    );
    setClientI18n(i18n);
    const when = new Date("2026-05-08T01:30:00Z");
    for (const Renderer of [Trans, CompiledTrans]) {
      expect(
        renderToStaticMarkup(
          <Renderer id="rich" values={{ name: "Ada" }} components={{ 0: <strong />, 1: <br /> }} />,
        ),
      ).toBe("Hello <strong>Ada</strong><br/>");
      expect(renderToStaticMarkup(<Renderer id="quoted" values={{ name: "Ada" }} />)).toBe(
        "Literal {name}, value: Ada",
      );
      expect(
        renderToStaticMarkup(
          <Renderer id="plural" values={{ count: 3 }} components={{ 0: <em /> }} />,
        ),
      ).toBe("<em>2 guests</em>");
      expect(renderToStaticMarkup(<Renderer id="select" values={{ gender: "toString" }} />)).toBe(
        "They",
      );
      expect(renderToStaticMarkup(<Renderer id="ordinal" values={{ count: 3 }} />)).toBe("3rd");
      expect(renderToStaticMarkup(<Renderer id="number" values={{ amount: 12.3 }} />)).toBe(
        "€12.30",
      );
      expect(renderToStaticMarkup(<Renderer id="when" values={{ when }} />)).toBe(
        `${new Intl.DateTimeFormat("en-US", { dateStyle: "full", timeZone: "America/Los_Angeles" }).format(when)} ${new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: "America/Los_Angeles" }).format(when)}`,
      );
    }
  });

  it("propagates missing messages and formatter failures to host handling through both entries", () => {
    const onMissing = vi.fn();
    const onError = vi.fn();
    const i18n = createI18n({ onMissing, onError });
    i18n.load(
      "en",
      defineCompiledCatalog(
        compileTestMessages({ plural: "{count, plural, one {One} other {Many}}" }),
      ),
    );
    setClientI18n(i18n);
    for (const Renderer of [Trans, CompiledTrans]) {
      expect(() =>
        renderToStaticMarkup(<Renderer id="private-key" message="Source {name}" />),
      ).toThrow(/required compiled message/);
      expect(() =>
        renderToStaticMarkup(
          <Renderer id="plural" message="Source" values={{ count: "invalid" }} />,
        ),
      ).toThrow(/non-numeric/);
    }
    expect(onMissing).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("builds locale switch items headlessly", () => {
    expect(typeof buildLocaleSwitchItems).toBe("function");
  });
});
