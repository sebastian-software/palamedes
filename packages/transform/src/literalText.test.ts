import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createI18n, defineCompiledCatalog } from "@palamedes/core";
import {
  analyzeMdxNative,
  compileCatalogArtifact,
  extractCatalogMessagesFromFiles,
  updateCatalogFile,
} from "@palamedes/core-node";

import { renderCatalogModule } from "./catalogLoader";
import { transformPalamedesMacros } from "./transform";

type CompiledCatalog = Parameters<ReturnType<typeof createI18n>["load"]>[1];

async function importCatalogModule(messages: Record<string, string>): Promise<CompiledCatalog> {
  const globalKey = "__palamedesLiteralTextDefineCompiledCatalog";
  Object.defineProperty(globalThis, globalKey, {
    configurable: true,
    value: defineCompiledCatalog,
  });
  const code = renderCatalogModule(messages)
    .replace(
      'import{defineCompiledCatalog as __palamedesDefineCompiledCatalog}from"@palamedes/core/compiled";',
      `const __palamedesDefineCompiledCatalog=globalThis.${globalKey};`,
    )
    .replace("export const messages=", "const messages=")
    .replace("export default { messages };", "export default messages;");
  try {
    const url = `data:text/javascript;charset=utf-8,${encodeURIComponent(code)}`;
    return ((await import(url)) as { default: CompiledCatalog }).default;
  } finally {
    delete (globalThis as Record<string, unknown>)[globalKey];
  }
}

describe("literal text in authored messages (#1373)", () => {
  it("renders literal braces after extraction, catalog compilation, and the transform", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "palamedes-literal-text-"));
    try {
      const sourcePath = path.join(rootDir, "src", "messages.ts");
      const mdxPath = path.join(rootDir, "src", "guide.mdx");
      const catalogPath = path.join(rootDir, "locales", "en", "messages.po");
      const source = [
        'import { t } from "@palamedes/core/macro";',
        "export function messages(name: string) {",
        "  return [",
        "    t`Type {name} to insert, hi ${name}`,",
        "    t`It's '{literal}' ok`,",
        "    t({ message: `Use {x} for ${name}` }),",
        "  ];",
        "}",
        "",
      ].join("\n");
      const mdx = "Use \\{name\\} literally.\n";
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await mkdir(path.dirname(catalogPath), { recursive: true });
      await writeFile(sourcePath, source);
      await writeFile(mdxPath, mdx);

      const extracted = extractCatalogMessagesFromFiles({
        rootDir,
        files: [sourcePath, mdxPath],
        maxThreads: 1,
      });
      expect(extracted.failedFiles).toEqual([]);
      expect(extracted.messages.map((message) => message.message).sort()).toEqual(
        [
          "Type '{name}' to insert, hi {name}",
          "It's '''{literal}''' ok",
          "Use '{x}' for {name}",
          "Use '{name}' literally.",
        ].sort(),
      );

      updateCatalogFile({
        targetPath: catalogPath,
        locale: "en",
        sourceLocale: "en",
        clean: false,
        messages: extracted.messages,
      });
      expect(await readFile(catalogPath, "utf8")).toContain(
        "msgid \"Type '{name}' to insert, hi {name}\"",
      );
      const artifact = compileCatalogArtifact(
        {
          rootDir,
          locales: ["en"],
          sourceLocale: "en",
          catalogs: [{ path: "locales/{locale}/messages", include: ["src"] }],
        },
        catalogPath,
      );
      expect(artifact.diagnostics).toEqual([]);

      const i18n = createI18n({ locale: "en" });
      i18n.load("en", await importCatalogModule(artifact.messages));

      // The transform derives the same compiled ids from its own lowering,
      // so every runtime lookup hits the catalog entry extraction wrote.
      const transformed = transformPalamedesMacros(source, "messages.ts");
      expect(transformed.compiledIds.every((id) => id in artifact.messages)).toBe(true);
      expect(transformed.compiledIds.map((id) => i18n._(id, { name: "Alice" }))).toEqual([
        "Type {name} to insert, hi Alice",
        "It's '{literal}' ok",
        "Use {x} for Alice",
      ]);

      const compiledMdx = analyzeMdxNative(mdx, "guide.mdx");
      expect(compiledMdx.compiledIds.map((id) => i18n._(id))).toEqual(["Use {name} literally."]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
