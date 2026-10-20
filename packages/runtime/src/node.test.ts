import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { t } from "@palamedes/core/macro";
import { afterEach, describe, expect, it } from "vitest";
import { resetI18nRuntime, setServerI18nGetter } from "./index";
import { defineNodeI18n } from "./node";
import type { RuntimeMacroManifest } from "./node-macros";

const manifest: RuntimeMacroManifest = {
  version: 1,
  templates: [{ strings: ["Hello."], key: "hello", values: [] }],
  descriptors: [],
  choices: [],
};

const directories: string[] = [];

function generated(): string {
  // Inside the package, so the catalog modules resolve @palamedes/core.
  const directory = mkdtempSync(path.join(import.meta.dirname, "../node_modules/.node-i18n-"));
  directories.push(directory);
  writeFileSync(path.join(directory, "macros.json"), JSON.stringify(manifest));
  mkdirSync(path.join(directory, "catalogs"));
  for (const [locale, text] of [
    ["de", "Hallo."],
    ["en", "Hello."],
  ]) {
    writeFileSync(
      path.join(directory, "catalogs", `${locale}.mjs`),
      `import { defineCompiledCatalog } from "@palamedes/core";\nexport const messages = defineCompiledCatalog(${JSON.stringify({ hello: text })});`,
    );
  }
  return directory;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("palamedes.runtimeMacros")];
  resetI18nRuntime();
});

describe("defineNodeI18n", () => {
  it("registers runtime macros and loads compiled catalogs into isolated instances", async () => {
    const createI18n = defineNodeI18n({ generated: pathToFileURL(generated()) });
    const [de, en] = await Promise.all([
      createI18n({ locale: "de", timeZone: "Europe/Berlin" }),
      createI18n({ locale: "en" }),
    ]);

    expect(de).not.toBe(en);
    expect(de.timeZone).toBe("Europe/Berlin");
    setServerI18nGetter(() => de);
    expect(t`Hello.`).toBe("Hallo.");
    setServerI18nGetter(() => en);
    expect(t`Hello.`).toBe("Hello.");
  });

  it("accepts a directory path and rejects locales without a compiled catalog", async () => {
    const createI18n = defineNodeI18n({ generated: generated() });

    await expect(createI18n({ locale: "fr" })).rejects.toThrow("Unsupported catalog locale");
    await expect(createI18n({ locale: "../de" })).rejects.toThrow("Unsupported catalog locale");
  });
});
