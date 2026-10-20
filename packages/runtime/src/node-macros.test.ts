import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createI18n, defineCompiledCatalog } from "@palamedes/core";
import { plural, select, t } from "@palamedes/core/macro";
import { afterEach, describe, expect, it } from "vitest";
import { resetI18nRuntime, setServerI18nGetter } from "./index";
import { registerRuntimeMacros, type RuntimeMacroManifest } from "./node-macros";

const manifest: RuntimeMacroManifest = {
  version: 1,
  templates: [
    { strings: ["Booking ", " is confirmed."], key: "booking", values: ["id"] },
    { strings: ["Hello."], key: "hello", values: [] },
  ],
  descriptors: [{ message: "Hi {name}", context: "greeting", key: "hi" }],
  choices: [
    {
      kind: "plural",
      options: { one: "# seat", other: "# seats", offset: "1" },
      value: "seats",
      key: "seats",
    },
    { kind: "select", options: { "1": "first", other: "later" }, value: "rank", key: "rank" },
  ],
};

function activate() {
  const i18n = createI18n({ locale: "de" });
  i18n.load(
    "de",
    defineCompiledCatalog({
      booking: (v, r) => r.join("Buchung ", r.value(v, "id"), " ist bestätigt."),
      hello: "Hallo.",
      hi: (v, r) => r.join("Hallo ", r.value(v, "name")),
      seats: (v, r) => r.join("seats=", r.value(v, "seats")),
      rank: (v, r) => r.join("rank=", r.value(v, "rank")),
    }),
  );
  setServerI18nGetter(() => i18n);
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("palamedes.runtimeMacros")];
  resetI18nRuntime();
});

describe("registerRuntimeMacros", () => {
  it("leaves macros failing loudly until registration", () => {
    expect(() => t`Hello.`).toThrow(/outside the compiler transform/);
    expect(() => plural(1, { one: "# seat", other: "# seats" })).toThrow(
      /outside the compiler transform/,
    );
  });

  it("renders templates, descriptors, and choices through the active i18n instance", () => {
    registerRuntimeMacros(manifest);
    activate();
    const id = "BK-1";
    const name = "Ada";

    expect(t`Booking ${id} is confirmed.`).toBe("Buchung BK-1 ist bestätigt.");
    expect(t`Hello.`).toBe("Hallo.");
    expect(t({ message: "Hi {name}", context: "greeting" }, { name })).toBe("Hallo Ada");
    expect(plural(2, { offset: 1, one: "# seat", other: "# seats" } as never)).toBe("seats=2");
    expect(select(1, { 1: "first", other: "later" } as never)).toBe("rank=1");
  });

  it("loads a manifest file and rejects calls the manifest does not know", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "palamedes-macros-"));
    const file = path.join(directory, "macros.json");
    writeFileSync(file, JSON.stringify(manifest));
    registerRuntimeMacros(pathToFileURL(file));
    activate();
    const id = "BK-1";

    expect(() => t`Booking ${id} was cancelled.`).toThrow(/no entry for t/);
    expect(() => plural(2, { one: "# guest", other: "# guests" })).toThrow(/no entry for plural/);
    expect(() => t({ message: "Hi {name}" }, { name: "Ada" })).toThrow(/no entry for t/);
  });

  it("propagates missing catalog entries instead of rendering keys", () => {
    registerRuntimeMacros({
      ...manifest,
      templates: [{ strings: ["Gone."], key: "gone", values: [] }],
    });
    activate();

    expect(() => t`Gone.`).toThrow(/compiled message is unavailable/);
  });

  it("rejects unknown manifest versions", () => {
    expect(() => registerRuntimeMacros({ ...manifest, version: 2 } as never)).toThrow(
      /Unsupported runtime macro manifest version/,
    );
  });
});
