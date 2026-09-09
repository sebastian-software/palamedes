// @vitest-environment jsdom
/* @jsxImportSource @solidjs/web */
import { createSignal } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, describe, expect, it } from "vitest";

import { createI18n } from "@palamedes/core";
import { resetI18nRuntime, setClientI18n } from "@palamedes/runtime";

import { Plural, Select, SelectOrdinal, Trans } from "./index";

describe("@palamedes/solid client components", () => {
  afterEach(() => {
    resetI18nRuntime();
    document.body.replaceChildren();
  });

  it("reacts when a signal-backed message prop changes", async () => {
    setClientI18n(createI18n({ locale: "en" }));
    const host = document.createElement("div");
    const [message, setMessage] = createSignal("Hello Ada");
    const dispose = render(() => <Trans message={message()} />, host);

    expect(host.textContent).toBe("Hello Ada");
    setMessage("Hello Lin");
    await Promise.resolve();
    expect(host.textContent).toBe("Hello Lin");

    dispose();
  });

  it("reacts when signal-backed plural props change", async () => {
    setClientI18n(createI18n({ locale: "en" }));
    const host = document.createElement("div");
    const [value, setValue] = createSignal(2);
    const [offset, setOffset] = createSignal(1);
    const [other, setOther] = createSignal("# items");
    const dispose = render(
      () => <Plural value={value()} offset={offset()} one="# item" other={other()} />,
      host,
    );

    expect(host.textContent).toBe("1 item");
    setValue(3);
    await Promise.resolve();
    expect(host.textContent).toBe("2 items");
    setOther("# objects");
    await Promise.resolve();
    expect(host.textContent).toBe("2 objects");
    setOffset(2);
    await Promise.resolve();
    expect(host.textContent).toBe("1 item");

    dispose();
  });

  it("reacts when signal-backed select props change", async () => {
    setClientI18n(createI18n({ locale: "en" }));
    const host = document.createElement("div");
    const [value, setValue] = createSignal("female");
    const [male, setMale] = createSignal("He");
    const dispose = render(
      () => <Select value={value()} female="She" male={male()} other="They" />,
      host,
    );

    expect(host.textContent).toBe("She");
    setValue("male");
    await Promise.resolve();
    expect(host.textContent).toBe("He");
    setMale("Him");
    await Promise.resolve();
    expect(host.textContent).toBe("Him");

    dispose();
  });

  it("reacts when signal-backed ordinal props change", async () => {
    setClientI18n(createI18n({ locale: "en" }));
    const host = document.createElement("div");
    const [value, setValue] = createSignal(2);
    const [offset, setOffset] = createSignal(0);
    const [few, setFew] = createSignal("#rd");
    const dispose = render(
      () => (
        <SelectOrdinal
          value={value()}
          offset={offset()}
          one="#st"
          two="#nd"
          few={few()}
          other="#th"
        />
      ),
      host,
    );

    expect(host.textContent).toBe("2nd");
    setValue(3);
    await Promise.resolve();
    expect(host.textContent).toBe("3rd");
    setFew("# place");
    await Promise.resolve();
    expect(host.textContent).toBe("3 place");
    setOffset(2);
    await Promise.resolve();
    expect(host.textContent).toBe("1st");

    dispose();
  });
});
