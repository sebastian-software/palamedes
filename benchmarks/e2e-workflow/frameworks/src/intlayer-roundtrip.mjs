import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  benchmarkRoot,
  filesUnder,
  FRAMEWORKS,
  inventoryForProfile,
  normalizeMessage,
  prepareFrameworkWorkspace,
  readFrameworkCatalogs,
  resetFrameworkWorkspace,
  seedFrameworkTranslations,
  validateFrameworkCatalogs,
  writeFrameworkSources,
} from "./framework-corpus.mjs";
import { runFrameworkTool } from "./framework-workflow.mjs";

export function seedTypeScriptDictionary(source) {
  const ast = ts.createSourceFile("dictionary.content.ts", source, ts.ScriptTarget.Latest, true);
  const edits = [];
  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(ast) === "en" &&
      ts.isStringLiteral(node.initializer)
    ) {
      edits.push({
        offset: node.end,
        text: `, de: ${JSON.stringify(`[de] ${node.initializer.text}`)}`,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const edit of edits.sort((a, b) => b.offset - a.offset))
    source = source.slice(0, edit.offset) + edit.text + source.slice(edit.offset);
  return { source, seeded: edits.length };
}

async function readTypeScriptCatalogs(root) {
  // Use the CLI's own built, unmerged dictionaries to inspect the TypeScript
  // declarations without evaluating user-authored code in this process.
  const catalogs = { en: [], de: [] };
  const unwrap = (node) =>
    node?.nodeType === "insertion" ? unwrap(node.insertion) : node?.translation;
  for (const file of await filesUnder(path.join(root, ".intlayer/unmerged_dictionary"))) {
    for (const dictionary of JSON.parse(await readFile(file, "utf8"))) {
      for (const [key, node] of Object.entries(dictionary.content)) {
        const translations = typeof node === "string" ? { en: node } : unwrap(node);
        if (typeof translations?.en !== "string")
          throw new Error(`Unexpected compiled dictionary node at ${file}/${key}`);
        for (const locale of ["en", "de"])
          catalogs[locale].push({
            id: `${dictionary.key}/${key}`,
            source: normalizeMessage(translations.en),
            translation: normalizeMessage(translations[locale] ?? ""),
          });
      }
    }
  }
  return catalogs;
}

async function main() {
  const inventory = inventoryForProfile("smoke");
  const temp = await mkdtemp(path.join(os.tmpdir(), "palamedes-intlayer-roundtrip-"));
  const cases = [];
  try {
    for (const framework of FRAMEWORKS)
      for (const format of ["json", "ts"]) {
        const lane = { id: `${framework}-intlayer-${format}`, framework, tool: "intlayer" };
        const root = path.join(temp, lane.id);
        await prepareFrameworkWorkspace(root, lane);
        if (format === "ts") {
          const configFile = path.join(root, "intlayer.config.mjs");
          await writeFile(
            configFile,
            (await readFile(configFile, "utf8")).replace(".content.json", ".content.ts"),
          );
        }
        await writeFrameworkSources(root, lane, inventory.baselineEntries, inventory.profile);
        await runFrameworkTool(root, lane, {});
        const read = () =>
          format === "ts" ? readTypeScriptCatalogs(root) : readFrameworkCatalogs(root, lane);
        const baseline = await read();
        for (const locale of ["en", "de"])
          if (
            JSON.stringify(baseline[locale].map((entry) => entry.source).sort()) !==
            JSON.stringify([...inventory.baselineMessages].sort())
          )
            throw new Error(`${lane.id}: initial inventory mismatch`);
        if (format === "ts") {
          let count = 0;
          for (const file of await filesUnder(path.join(root, "src/locales"))) {
            const seeded = seedTypeScriptDictionary(await readFile(file, "utf8"));
            count += seeded.seeded;
            await writeFile(file, seeded.source);
          }
          if (count !== inventory.baselineMessages.length)
            throw new Error(
              `${lane.id}: seeded ${count} entries, expected ${inventory.baselineMessages.length}`,
            );
          await cp(path.join(root, "src/locales"), path.join(root, ".baseline-locales"), {
            recursive: true,
          });
        } else await seedFrameworkTranslations(root, lane);
        await writeFrameworkSources(root, lane, inventory.sourceMessages, inventory.profile);
        await resetFrameworkWorkspace(root);
        await runFrameworkTool(root, lane, {});
        try {
          cases.push({
            ...lane,
            status: "validated",
            validation: validateFrameworkCatalogs(await read(), inventory, lane.id),
          });
        } catch (error) {
          if (!error.validation) throw error;
          cases.push({
            ...lane,
            status: "not-equivalent",
            reason: error.message,
            validation: error.validation,
          });
        }
      }
    const report = {
      schemaVersion: 1,
      benchmark: "intlayer-catalog-roundtrip-conformance",
      timings: false,
      generatedAt: new Date().toISOString(),
      version: JSON.parse(
        await readFile(
          path.join(benchmarkRoot, "node_modules/@intlayer/babel/package.json"),
          "utf8",
        ),
      ).version,
      probeSha256: createHash("sha256")
        .update(await readFile(fileURLToPath(import.meta.url)))
        .digest("hex"),
      corpus: {
        profile: "smoke",
        current: inventory.sourceMessages.length,
        baseline: inventory.baselineMessages.length,
        changed: inventory.profile.changedCount,
        added: inventory.profile.newCount,
        removed: inventory.profile.removedCount,
      },
      command: "pnpm --dir benchmarks/e2e-workflow/frameworks diagnose:intlayer",
      cases,
    };
    const output = path.resolve(benchmarkRoot, "../results/frameworks");
    await mkdir(output, { recursive: true });
    const stamp = report.generatedAt.replaceAll(/[:.]/gu, "-");
    await writeFile(
      path.join(output, `${stamp}-intlayer-roundtrip.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    const lines = [
      "# Intlayer 9.7.0 Catalog Roundtrip Conformance",
      "",
      "This untimed smoke check compares both supported dictionary formats. It uses the same generated components and catalog inventory as the workflow benchmark. The TypeScript path is inspected through Intlayer's own built unmerged JSON artifacts; source dictionary entries are seeded by TypeScript AST positions.",
      "",
      "| Framework | Dictionary format | Current messages | Written messages | Existing translations retained | Result |",
      "| --- | --- | ---: | ---: | --- | --- |",
      ...cases.map(
        (row) =>
          `| ${row.framework} | .content.${row.id.endsWith("-ts") ? "ts" : "json"} | ${row.validation.activeMessagesPerLocale} | ${row.validation.observed.de.total} | ${row.validation.preservedTranslations}/${row.validation.expectedPreservedTranslations} | ${row.status} |`,
      ),
      "",
      "Both formats retain removed entries in this fixture. The TypeScript format preserves the unchanged translations, while the JSON format loses the interpolated translations. This is a version/configuration-specific conformance result, not a timing or a claim about every Intlayer workflow.",
      "",
      "```sh",
      report.command,
      "```",
      "",
    ];
    await writeFile(path.join(output, `${stamp}-intlayer-roundtrip.md`), lines.join("\n"));
    console.log(path.join(output, `${stamp}-intlayer-roundtrip.md`));
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
