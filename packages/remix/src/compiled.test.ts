// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createI18n,
  defineCompiledCatalog,
  MissingCompiledMessageError,
  type CompiledMessage,
  type CompiledMessageBranch,
} from "@palamedes/core/compiled";
import { resetI18nRuntime, setClientI18n } from "@palamedes/runtime";
import { createElement, type RemixElement } from "remix/component";
import { renderToString } from "remix/component/server";
import { render } from "remix/component/test";

import { Trans, type TransProps } from "./compiled";
import type {
  Plural as MacroPlural,
  Select as MacroSelect,
  SelectOrdinal as MacroSelectOrdinal,
  Trans as MacroTrans,
} from "./macro";
import { createRemixMessageRuntimeCache, createTrans } from "./transShared";

describe("@palamedes/remix compiled rich-message runtime", () => {
  afterEach(() => {
    resetI18nRuntime();
    document.body.replaceChildren();
  });

  it("renders equivalent rich HTML on the server and in the browser", async () => {
    const message: CompiledMessage = (values, runtime) =>
      runtime.join(
        "Hallo ",
        runtime.value(values, "name"),
        ", ",
        runtime.tag("0", runtime.join("Dokumentation")),
        " — ",
        runtime.value(values, "details"),
      );
    const i18n = createI18n({ locale: "de" });
    i18n.load("de", defineCompiledCatalog({ greeting: message }));
    setClientI18n(i18n);

    const props: TransProps = {
      id: "greeting",
      values: {
        name: "Ada",
        details: ["A", [createElement("em", {}, "B"), null, undefined, [], ""], 0],
      },
      components: {
        0: createElement("a", { class: "docs", href: "/docs", title: "Guide" }),
      },
    };
    const serverHtml = await renderToString(createElement(Trans, props));
    const browser = render(createElement(Trans, props));
    expect(serverHtml).toBe(
      'Hallo Ada, <a href="/docs" title="Guide" class="docs">Dokumentation</a> — A<em>B</em>0',
    );
    expect(browser.container.innerHTML).toBe(
      'Hallo Ada, <a class="docs" href="/docs" title="Guide">Dokumentation</a> — A<em>B</em>0',
    );
    browser.cleanup();
  });

  it("keeps repeated tags ordered and renders nested choices", async () => {
    const female: CompiledMessageBranch = (_values, runtime, pluralValue) =>
      runtime.join("Sie hat ", runtime.pound(pluralValue!), " Nachrichten");
    const otherGender: CompiledMessageBranch = (_values, runtime, pluralValue) =>
      runtime.join("Sie haben ", runtime.pound(pluralValue!), " Nachrichten");
    const one: CompiledMessageBranch = (_values, runtime) => runtime.join("Eine Nachricht");
    const many: CompiledMessageBranch = (values, runtime, pluralValue) =>
      runtime.select(values, "gender", { female, other: otherGender }, pluralValue);
    const inbox: CompiledMessage = (values, runtime) =>
      runtime.join(
        runtime.tag("0", runtime.join("Posteingang")),
        ": ",
        runtime.plural(values, "count", 0, "plural", { one, other: many }),
        " / ",
        runtime.tag("0", runtime.join("öffnen")),
      );
    const i18n = createI18n({ locale: "de" });
    i18n.load("de", defineCompiledCatalog({ inbox }));
    setClientI18n(i18n);

    const html = await renderToString(
      createElement(Trans, {
        id: "inbox",
        values: { count: 3, gender: "female" },
        components: { 0: createElement("strong", { class: "label" }) },
      }),
    );

    expect(html).toBe(
      '<strong class="label">Posteingang</strong>: Sie hat 3 Nachrichten / <strong class="label">öffnen</strong>',
    );
  });

  it("reuses a leased runtime across shapes without keeping stale elements and invalidates on locale changes", async () => {
    const i18n = createI18n({ locale: "en", timeZone: "UTC" });
    const cache = createRemixMessageRuntimeCache();

    const firstLease = cache.acquire(i18n, {
      0: createElement("strong", { class: "first" }),
    });
    const first = firstLease.runtime.tag("0", firstLease.runtime.join("one"))[0] as RemixElement;
    cache.release(firstLease);
    // Releasing clears retained component references immediately.
    expect(firstLease.runtime.tag("0", firstLease.runtime.join("released"))).toEqual(["released"]);

    const secondLease = cache.acquire(i18n, {
      1: createElement("em", { class: "second" }),
    });
    const second = secondLease.runtime.tag("1", secondLease.runtime.join("two"))[0] as RemixElement;
    cache.release(secondLease);

    expect(secondLease.runtime).toBe(firstLease.runtime);
    expect([first.key, second.key]).toEqual([0, 0]);
    await expect(renderToString(first)).resolves.toBe('<strong class="first">one</strong>');
    await expect(renderToString(second)).resolves.toBe('<em class="second">two</em>');

    i18n.activate("de");
    const localeChangedLease = cache.acquire(i18n, {
      0: createElement("strong", { class: "de" }),
    });
    cache.release(localeChangedLease);
    expect(localeChangedLease.runtime).not.toBe(firstLease.runtime);
  });

  it("isolates nested synchronous Trans renders and releases component references afterwards", async () => {
    const outer: CompiledMessage = (args, runtime) =>
      runtime.join(
        runtime.tag("0", runtime.join("before")),
        runtime.value(args, "nested"),
        runtime.tag("0", runtime.join("after")),
      );
    const inner: CompiledMessage = (_values, runtime) => runtime.tag("0", runtime.join("inside"));
    const i18n = createI18n({ locale: "en" });
    i18n.load("en", defineCompiledCatalog({ outer, inner }));
    const NestedTrans = createTrans(() => i18n);
    const renderMessage = vi.spyOn(i18n, "renderMessage");

    const values = {
      get nested() {
        return NestedTrans({
          props: { id: "inner", components: { 0: createElement("em", {}) } },
        } as never)();
      },
    };
    const rendered = NestedTrans({
      props: {
        id: "outer",
        values,
        components: { 0: createElement("strong", {}) },
      },
    } as never)();

    await expect(renderToString(rendered)).resolves.toBe(
      "<strong>before</strong><em>inside</em><strong>after</strong>",
    );
    const outerRuntime = renderMessage.mock.calls[0]![2];
    const innerRuntime = renderMessage.mock.calls[1]![2];
    expect(innerRuntime).not.toBe(outerRuntime);
    expect(outerRuntime.tag("0", outerRuntime.join("released"))).toEqual(["released"]);
    expect(innerRuntime.tag("0", innerRuntime.join("released"))).toEqual(["released"]);
  });

  it("releases a leased renderer when renderMessage throws", () => {
    const i18n = createI18n({ locale: "en" });
    i18n.load("en", defineCompiledCatalog({ Hello: "Hello" }));
    const renderMessage = vi.spyOn(i18n, "renderMessage").mockImplementationOnce(() => {
      throw new Error("custom renderer failed");
    });
    const CachedTrans = createTrans(() => i18n);

    expect(() =>
      CachedTrans({
        props: { id: "Hello", components: { 0: createElement("strong", {}) } },
      } as never)(),
    ).toThrow("custom renderer failed");

    CachedTrans({ props: { id: "Hello" } } as never)();
    const runtime = renderMessage.mock.calls[0]![2];
    expect(renderMessage.mock.calls[1]![2]).toBe(runtime);
    expect(runtime.tag("0", runtime.join("released"))).toEqual(["released"]);
  });

  it("propagates missing and invalid messages to host rendering", async () => {
    const malformed: CompiledMessage = () => {
      throw new Error("Invalid compiled message");
    };
    const i18n = createI18n({ locale: "de" });
    i18n.load("de", defineCompiledCatalog({ malformed }));
    setClientI18n(i18n);
    await expect(
      renderToString(createElement(Trans, { id: "missing", message: "Source {name}" })),
    ).rejects.toThrow(/required compiled message/);
    await expect(
      renderToString(createElement(Trans, { id: "malformed", message: "Source" })),
    ).rejects.toThrow("Invalid compiled message");
  });

  it("looks messages up by id and never by the diagnostic message", async () => {
    const i18n = createI18n({ locale: "de" });
    i18n.load(
      "de",
      defineCompiledCatalog({ "compiled-key": "Kompiliert", "Source text": "Source lookup" }),
    );
    setClientI18n(i18n);

    await expect(
      renderToString(createElement(Trans, { id: "compiled-key", message: "Source text" })),
    ).resolves.toBe("Kompiliert");
    // Untyped callers cannot fall back to the source message as a lookup key.
    const withoutId = { message: "Source text" } as unknown as TransProps;
    await expect(renderToString(createElement(Trans, withoutId))).rejects.toThrow(
      MissingCompiledMessageError,
    );
  });

  it("requires the compiled id in runtime Trans props", () => {
    // @ts-expect-error The transform injects `id`; `message` is diagnostic metadata only.
    const props: TransProps = { message: "Hello" };
    expect(props).toEqual({ message: "Hello" });
  });

  it("exposes Remix-native macro component types", () => {
    type MacroTransProps = Parameters<typeof MacroTrans>[0]["props"];
    type MacroPluralProps = Parameters<typeof MacroPlural>[0]["props"];
    type MacroSelectProps = Parameters<typeof MacroSelect>[0]["props"];
    type MacroSelectOrdinalProps = Parameters<typeof MacroSelectOrdinal>[0]["props"];

    const trans = {
      message: "Hello Ada",
      context: "greeting",
      comment: "Shown first",
      children: ["Hello ", createElement("strong", {}, "Ada")],
    } satisfies MacroTransProps;
    const plural = { value: 2, one: "one", other: "other" } satisfies MacroPluralProps;
    const select = { value: "female", female: "She", other: "They" } satisfies MacroSelectProps;
    const ordinal = { value: 3, one: "first", other: "other" } satisfies MacroSelectOrdinalProps;
    const reactOnlyElement = { key: null, props: {}, type: "strong" };

    // @ts-expect-error React-shaped elements do not carry Remix UI's $rmx brand.
    const invalidComponents: NonNullable<TransProps["components"]> = { 0: reactOnlyElement };

    expect([trans, plural, select, ordinal, invalidComponents]).toHaveLength(5);
  });
});
