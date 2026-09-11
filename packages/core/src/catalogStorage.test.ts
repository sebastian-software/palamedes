import { describe, expect, it, vi } from "vitest";

import {
  createI18n as createCompiledI18n,
  defineCompiledCatalog,
  type CompiledMessage,
} from "./compiled";
import { createStringMessageRuntime } from "./compiledMessage";
import { createI18n } from "./index";

describe.each([
  ["package root", createI18n],
  ["parser-free", createCompiledI18n],
] as const)("%s catalog storage", (_name, create) => {
  it("preserves literal ICU text, empty strings, and special IDs without reporting misses", () => {
    const onMissing = vi.fn();
    const onError = vi.fn();
    const i18n = create({ onMissing, onError });
    i18n.load(
      "en",
      defineCompiledCatalog({
        literal: "Hello {name}",
        empty: "",
        ["__proto__"]: "Prototype",
        constructor: "Constructor",
        toString: "String",
      }),
    );

    expect(i18n._("literal", { name: "Ada" })).toBe("Hello {name}");
    expect(i18n._("empty", undefined, { message: "Fallback" })).toBe("");
    expect(i18n._("__proto__")).toBe("Prototype");
    expect(i18n._("constructor")).toBe("Constructor");
    expect(i18n._("toString")).toBe("String");
    expect(onMissing).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    expect(() => i18n._("hasOwnProperty", undefined, { message: "Missing" })).toThrow(
      /required compiled message/,
    );
    expect(onMissing).toHaveBeenCalledOnce();
  });

  it("snapshots loaded entries and merges later chunks without changing other locales", () => {
    const i18n = create();
    const messages = defineCompiledCatalog({ greeting: "Hello", untouched: "Keep" });
    i18n.load("en", messages);
    expect(Object.isFrozen(messages)).toBe(true);
    expect(i18n._("greeting")).toBe("Hello");

    i18n.load("de", defineCompiledCatalog({ greeting: "Hallo" }));
    const greeting: CompiledMessage = (values, runtime) => runtime.value(values, "name");
    i18n.load("en", defineCompiledCatalog({ greeting, added: "New" }));
    expect(i18n._("greeting", { name: "Ada" })).toBe("Ada");
    expect(i18n._("untouched")).toBe("Keep");
    expect(i18n._("added")).toBe("New");

    i18n.load("en", defineCompiledCatalog({ greeting: "Replaced" }));
    expect(i18n._("greeting")).toBe("Replaced");
    i18n.activate("de");
    expect(i18n._("greeting")).toBe("Hallo");
    i18n.activate("en");
    expect(i18n._("greeting")).toBe("Replaced");
  });

  it("does not enumerate catalog entries again for warmed loads", () => {
    const catalog = defineCompiledCatalog({ greeting: "Hello" });
    const ownKeys = vi.spyOn(Object, "keys");
    const entries = vi.spyOn(Object, "entries");

    for (let index = 0; index < 200; index += 1) {
      const i18n = create();
      i18n.load("en", catalog);
      expect(i18n._("greeting")).toBe("Hello");
    }

    const ownKeysCount = ownKeys.mock.calls.length;
    const entriesCount = entries.mock.calls.length;
    ownKeys.mockRestore();
    entries.mockRestore();
    expect(ownKeysCount).toBe(0);
    expect(entriesCount).toBe(0);
  });

  it("still passes compiled constants through the supplied host renderer", () => {
    const i18n = create();
    i18n.load("en", defineCompiledCatalog({ constant: "Hello", empty: "" }));
    const runtime = createStringMessageRuntime("en");
    vi.spyOn(runtime, "join").mockImplementation((...parts) => `[${parts.join("")}]`);

    expect(i18n.renderMessage!("constant", {}, runtime)).toBe("[Hello]");
    expect(i18n.renderMessage!("empty", {}, runtime)).toBe("[]");
    expect(i18n._("constant")).toBe("Hello");
    expect(runtime.join).toHaveBeenCalledTimes(2);
  });
});
