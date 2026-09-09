import { describe, expect, it, vi } from "vitest";

import {
  createI18n as createCompiledI18n,
  defineCompiledCatalog,
  type CompiledMessage,
} from "./compiled";
import { createStringMessageRuntime } from "./compiledMessage";
import { createI18n } from "./index";

describe.each([
  ["compatibility", createI18n],
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

    expect(i18n._("hasOwnProperty", undefined, { message: "Missing" })).toBe("Missing");
    expect(onMissing).toHaveBeenCalledOnce();
  });

  it("snapshots loaded entries and merges later chunks without changing other locales", () => {
    const i18n = create();
    const messages = defineCompiledCatalog({ greeting: "Hello", untouched: "Keep" });
    i18n.load("en", messages);
    messages.greeting = "Mutated after loading";
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

  it("still passes compiled constants through the supplied host renderer", () => {
    const i18n = create();
    i18n.load("en", defineCompiledCatalog({ constant: "Hello", empty: "" }));
    const runtime = createStringMessageRuntime("en", (pattern) => pattern);
    vi.spyOn(runtime, "join").mockImplementation((...parts) => `[${parts.join("")}]`);

    expect(i18n.renderMessage!("constant", {}, runtime)).toBe("[Hello]");
    expect(i18n.renderMessage!("empty", {}, runtime)).toBe("[]");
    expect(i18n._("constant")).toBe("Hello");
    expect(runtime.join).toHaveBeenCalledTimes(2);
  });
});

describe("mixed compatibility catalogs", () => {
  it("replaces each entry's interpretation when manual and generated chunks overlap", () => {
    const i18n = createI18n();
    const values = { name: "Ada" };
    i18n.load("en", defineCompiledCatalog({ greeting: "Hello {name}", literal: "Keep {name}" }));
    expect(i18n._("greeting", values)).toBe("Hello {name}");

    i18n.load("en", { greeting: "Hello {name}", manual: "Manual {name}" });
    expect(i18n._("greeting", values)).toBe("Hello Ada");
    expect(i18n._("literal", values)).toBe("Keep {name}");

    i18n.load("en", defineCompiledCatalog({ greeting: "Hello {name}" }));
    expect(i18n._("greeting", values)).toBe("Hello {name}");
    expect(i18n._("manual", values)).toBe("Manual Ada");

    const greeting: CompiledMessage = (v, runtime) => runtime.value(v, "name");
    // Copies lose their catalog brand, but function entries remain executable.
    i18n.load("en", { ...defineCompiledCatalog({ greeting, copied: "Copied {name}" }) });
    expect(i18n._("greeting", values)).toBe("Ada");
    expect(i18n._("copied", values)).toBe("Copied Ada");
    expect(i18n.getMessage("greeting")).toBe("{name}");

    i18n.load("en", { greeting: "Final {name}" });
    expect(i18n._("greeting", values)).toBe("Final Ada");
    expect(i18n.getMessageNodes("greeting")).toEqual([
      { type: "text", value: "Final " },
      { type: "variable", name: "name" },
    ]);
  });
});
