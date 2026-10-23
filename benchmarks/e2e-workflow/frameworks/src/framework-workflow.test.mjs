import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse as parseVue } from "vue/compiler-sfc";
import { parse as parseSvelte } from "svelte/compiler";
import ts from "typescript";

import {
  frameworkLanes,
  inventoryForProfile,
  normalizeMessage,
  filesUnder,
  readFrameworkCatalogs,
  renderFrameworkComponent,
  validateFrameworkCatalogs,
  writeFrameworkSources,
} from "./framework-corpus.mjs";
import { parseFrameworkArgs, summarizeSamples } from "./framework-workflow.mjs";

test("the framework matrix only includes supported adapters and distinguishes extra build work", () => {
  const lanes = frameworkLanes();
  assert.equal(lanes.length, 15);
  assert.ok(!lanes.some((lane) => lane.framework === "vue" && lane.tool === "wuchale"));
  assert.ok(!lanes.some((lane) => lane.framework !== "vue" && lane.tool === "gettext"));
  assert.deepEqual(
    [
      ...new Set(
        lanes.filter((lane) => lane.scope === "extract-update-compile").map((lane) => lane.tool),
      ),
    ].sort(),
    ["intlayer", "wuchale"],
  );
});

test("generated fixtures parse as real Vue, Svelte and TSX, including realistic application logic", () => {
  const messages = [{ current: "Pay for {name}" }, { current: "Save & continue <today>" }];
  for (const lane of frameworkLanes()) {
    for (const entries of [messages, []]) {
      const code = renderFrameworkComponent(lane, entries, 3, 160);
      assert.equal(code.trimEnd().split("\n").length, 160, lane.id);
      if (lane.framework === "vue") {
        const result = parseVue(code, { filename: "Fixture.vue" });
        assert.deepEqual(result.errors, [], lane.id);
      } else if (lane.framework === "svelte") {
        assert.doesNotThrow(() => parseSvelte(code), lane.id);
      } else {
        const source = ts.createSourceFile(
          "Fixture.tsx",
          code,
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );
        assert.deepEqual(source.parseDiagnostics, [], lane.id);
      }
    }
  }
});

test("placeholder normalization only unifies the corpus's one variable", () => {
  assert.equal(normalizeMessage("Hello %{ name }"), "Hello {name}");
  assert.equal(normalizeMessage("Hello {{name}}"), "Hello {name}");
  assert.equal(normalizeMessage("Hello {0}"), "Hello {name}");
  assert.equal(normalizeMessage("{other}"), "{other}");
});

function validCatalogs(inventory) {
  return Object.fromEntries(
    ["en", "de"].map((locale) => [
      locale,
      inventory.sourceMessages.map((entry) => ({
        source: entry.current,
        translation: locale === "de" && entry.state === "unchanged" ? `[de] ${entry.current}` : "",
        id: entry.current,
      })),
    ]),
  );
}

test("catalog correctness rejects missing, duplicate, stale and lost translated messages", () => {
  const inventory = inventoryForProfile("smoke");
  const catalogs = validCatalogs(inventory);
  const receipt = validateFrameworkCatalogs(catalogs, inventory, "smoke");
  assert.equal(receipt.activeMessagesPerLocale, 32);
  assert.equal(receipt.preservedTranslations, 25);
  for (const mutate of [
    (data) => data.de.pop(),
    (data) => data.de.push(data.de[0]),
    (data) => {
      data.de[0].source = "Stale source";
    },
    (data) => {
      data.de.at(-1).translation = "";
    },
  ]) {
    const corrupted = structuredClone(catalogs);
    mutate(corrupted);
    assert.throws(() => validateFrameworkCatalogs(corrupted, inventory, "corrupt"));
  }
});

test("retained translations of changed text are reported separately", () => {
  const inventory = inventoryForProfile("smoke");
  const catalogs = validCatalogs(inventory);
  catalogs.de[0].translation = `[de] ${inventory.sourceMessages[0].previous}`;
  assert.equal(
    validateFrameworkCatalogs(catalogs, inventory, "stable-id").retainedChangedTranslations,
    1,
  );
});

test("benchmark selection rejects unknown scopes and invalid sample counts", () => {
  assert.throws(() => parseFrameworkArgs(["--framework", "react"]));
  assert.throws(() => parseFrameworkArgs(["--runs", "0"]));
  assert.throws(() => parseFrameworkArgs(["--warmup", "-1"]));
  assert.throws(() => parseFrameworkArgs(["--tools"]));
  assert.deepEqual(
    parseFrameworkArgs(["--framework", "svelte", "--tools", "wuchale,palamedes"]).tools,
    ["wuchale", "palamedes"],
  );
});

test("statistics preserve observation order and expose dispersion", () => {
  assert.deepEqual(summarizeSamples([5, 1, 3]), {
    medianMs: 3,
    minMs: 1,
    maxMs: 5,
    medianAbsoluteDeviationMs: 2,
    samplesMs: [5, 1, 3],
  });
});

test("adding messages preserves the component location of existing copy", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "framework-location-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inventory = inventoryForProfile("small");
  const lane = { framework: "vue", tool: "palamedes" };
  const locate = async () => {
    const locations = new Map();
    for (const file of await filesUnder(path.join(root, "src/generated"))) {
      const source = await readFile(file, "utf8");
      for (const entry of inventory.sourceMessages.filter((entry) => entry.state === "unchanged")) {
        if (source.includes(entry.current)) locations.set(entry.current, path.basename(file));
      }
    }
    return locations;
  };
  await writeFrameworkSources(root, lane, inventory.baselineEntries, inventory.profile);
  const baseline = await locate();
  await writeFrameworkSources(root, lane, inventory.sourceMessages, inventory.profile);
  assert.equal(baseline.size, 528);
  assert.deepEqual(await locate(), baseline);
});

test("catalog readers handle obsolete PO comments and Intlayer insertion nodes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "framework-reader-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, "src/locales");
  await mkdir(dir, { recursive: true });
  for (const locale of ["en", "de"]) {
    await writeFile(
      path.join(dir, `${locale}.po`),
      `msgid ""\nmsgstr ""\n"Language: ${locale}\\n"\n\nmsgid "Hello {0}"\nmsgstr "${locale === "de" ? "[de] " : ""}Hello {0}"\n\n#~ #@ obsolete-since: 2026-10-23\n#~ msgid "Old"\n#~ msgstr "Old"\n`,
    );
  }
  const po = await readFrameworkCatalogs(root, { tool: "wuchale" });
  assert.deepEqual(
    po.de.map(({ source, translation }) => ({ source, translation })),
    [{ source: "Hello {name}", translation: "[de] Hello {name}" }],
  );
  await writeFile(
    path.join(dir, "example.content.json"),
    JSON.stringify({
      key: "example",
      content: {
        greeting: {
          nodeType: "insertion",
          insertion: {
            nodeType: "translation",
            translation: { en: "Hello {{name}}", de: "[de] Hello {{name}}" },
          },
        },
      },
    }),
  );
  const dictionaries = await readFrameworkCatalogs(root, { tool: "intlayer" });
  assert.deepEqual(dictionaries.de, [
    { source: "Hello {name}", translation: "[de] Hello {name}", id: "example/greeting" },
  ]);
});
