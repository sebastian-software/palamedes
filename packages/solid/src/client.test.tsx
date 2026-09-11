// @vitest-environment jsdom
/* @jsxImportSource @solidjs/web */
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it } from "vitest";

import { createI18n, defineCompiledCatalog } from "@palamedes/core";
import { resetI18nRuntime, setClientI18n } from "@palamedes/runtime";

import { compileTestMessages } from "../../../scripts/test-support/compiled-messages.mjs";

import { Trans } from "./index";

describe("@palamedes/solid client components", () => {
  afterEach(() => {
    resetI18nRuntime();
    document.body.replaceChildren();
  });

  it("reacts to compiled message identity and interpolation changes", async () => {
    const i18n = createI18n({ locale: "en" });
    i18n.load(
      "en",
      defineCompiledCatalog(
        compileTestMessages({ hello: "Hello {name}", welcome: "Welcome {name}" }),
      ),
    );
    setClientI18n(i18n);
    const host = document.createElement("div");
    const [id, setId] = createSignal("hello");
    const [name, setName] = createSignal("Ada");
    const dispose = render(() => <Trans id={id()} values={{ name: name() }} />, host);
    expect(host.textContent).toBe("Hello Ada");
    setName("Lin");
    await Promise.resolve();
    expect(host.textContent).toBe("Hello Lin");
    setId("welcome");
    await Promise.resolve();
    expect(host.textContent).toBe("Welcome Lin");
    dispose();
  });

  it("reacts to plural, select and ordinal values through compiled branches", async () => {
    const i18n = createI18n({ locale: "en" });
    i18n.load(
      "en",
      defineCompiledCatalog(
        compileTestMessages({
          plural: "{count, plural, offset:1 one {# item} other {# items}}",
          ordinal: "{count, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}",
          select: "{kind, select, mine {Mine} other {Other}}",
        }),
      ),
    );
    setClientI18n(i18n);
    const host = document.createElement("div");
    const [count, setCount] = createSignal(2);
    const [kind, setKind] = createSignal("mine");
    const dispose = render(
      () => (
        <>
          <Trans id="plural" values={{ count: count() }} /> /{" "}
          <Trans id="ordinal" values={{ count: count() }} /> /{" "}
          <Trans id="select" values={{ kind: kind() }} />
        </>
      ),
      host,
    );
    expect(host.textContent).toBe("1 item / 2nd / Mine");
    setCount(3);
    setKind("other");
    await Promise.resolve();
    expect(host.textContent).toBe("2 items / 3rd / Other");
    dispose();
  });
});
