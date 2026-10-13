import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { loadPalamedesConfigSync } from "../packages/config/dist/index.mjs";
import { createI18n } from "../packages/core/dist/compiled.mjs";
import {
  compileCatalogModule,
  extractMessagesNative,
  parsePo,
  transformMacrosNative,
} from "../packages/core-node/dist/index.mjs";
import {
  createFixture,
  extractFixture,
  fixtures,
  recipeFiles,
  sourceFiles,
  writeFixtureFile,
} from "./adoption-skill-fixtures.mjs";

const mapping = JSON.parse(readFileSync(path.join(fixtures, "lingui/mapping.json"), "utf8"));
const identity = (message, context) => JSON.stringify([message, context ?? null]);
const activeEntries = (source) =>
  parsePo(source).items.filter((entry) => entry.msgid && !entry.obsolete);
const catalog = (directory, locale) => path.join(directory, `src/locales/${locale}.po`);

function extracted(directory) {
  return sourceFiles(path.join(directory, "src")).flatMap((filename) =>
    extractMessagesNative(readFileSync(filename, "utf8"), filename),
  );
}

function assertPreservedMigration(directory, locale) {
  const original = parsePo(
    readFileSync(path.join(fixtures, `lingui/src/locales/${locale}.po`), "utf8"),
  );
  const migrated = parsePo(readFileSync(catalog(directory, locale), "utf8"));
  assert.equal(migrated.headers["Project-Id-Version"], original.headers["Project-Id-Version"]);
  for (const item of original.items.filter((entry) => entry.msgid && !entry.obsolete)) {
    const target = mapping.find(
      (entry) => identity(entry.old, entry.context) === identity(item.msgid, item.msgctxt),
    );
    assert.ok(target, `No target for ${item.msgid}`);
    const entry = migrated.items.find(
      (candidate) =>
        !candidate.obsolete &&
        identity(candidate.msgid, candidate.msgctxt) === identity(target.message, target.context),
    );
    assert.ok(entry, `Missing migrated identity ${target.message}/${target.context}`);
    assert.deepEqual(entry.msgstr, item.msgstr, `Translation changed for ${item.msgid}`);
    assert.deepEqual(entry.comments, item.comments, `Translator notes changed for ${item.msgid}`);
    assert.deepEqual(entry.flags, item.flags, `Flags changed for ${item.msgid}`);
    assert.deepEqual(entry.metadata, item.metadata, `Metadata changed for ${item.msgid}`);
  }
}

async function assertCompiledOutput(directory, locale, migration) {
  const config = loadPalamedesConfigSync({ cwd: directory });
  const result = compileCatalogModule(config, catalog(directory, locale), {
    locale,
    failOnMissing: true,
  });
  assert.deepEqual(result.warnings, []);
  const filename = `compiled-${locale}.mjs`;
  writeFixtureFile(directory, filename, result.code);
  const { messages } = await import(pathToFileURL(path.join(directory, filename)).href);
  const i18n = createI18n({ locale });
  i18n.load(locale, messages);
  const expected = activeEntries(readFileSync(catalog(directory, locale), "utf8"));
  for (const entry of expected) {
    const source = `import { t } from "@palamedes/core/macro"; export function label() { return t(${JSON.stringify({ message: entry.msgid, ...(entry.msgctxt ? { context: entry.msgctxt } : {}) })}); }`;
    const transformed = transformMacrosNative(source, "src/label.ts");
    assert.equal(transformed.compiledIds.length, 1);
    const output = i18n._(transformed.compiledIds[0], { count: 2, name: "Ada" });
    if (entry.msgid === "Hello {name}")
      assert.equal(output, locale === "de" ? "Hallo Ada" : "Hello Ada");
    else if (entry.msgid.startsWith("{count, plural"))
      assert.equal(output, locale === "de" ? "2 Angebote" : "2 offers");
    else assert.equal(output, entry.msgstr[0]);
  }
  assert.equal(expected.length, migration ? mapping.length + 1 : 1);
  assert.throws(() => i18n._("missing-compiled-entry"));
}

for (const host of ["nextjs", "vite-react"]) {
  for (const migration of [false, true]) {
    test(`${host}: ${migration ? "Lingui migration" : "setup"} recipes extract stably and render both compiled locales`, async (t) => {
      const directory = createFixture(host, migration);
      t.after(() => rmSync(directory, { recursive: true, force: true }));
      extractFixture(directory);
      if (!migration) {
        for (const locale of ["en", "de"]) {
          writeFixtureFile(
            directory,
            `src/locales/${locale}.po`,
            `msgid ""\nmsgstr ""\n"Language: ${locale}\\n"\n\nmsgid "Welcome to Palamedes"\nmsgstr "${locale === "de" ? "Willkommen bei Palamedes" : "Welcome to Palamedes"}"\n`,
          );
        }
      } else {
        for (const locale of ["en", "de"]) assertPreservedMigration(directory, locale);
      }
      const expected = [
        identity("Welcome to Palamedes"),
        ...(migration ? mapping.map((entry) => identity(entry.message, entry.context)) : []),
      ];
      assert.deepEqual(
        extracted(directory)
          .map((entry) => identity(entry.message, entry.context))
          .sort(),
        expected.sort(),
      );
      extractFixture(directory);
      const snapshot = ["en", "de"].map((locale) =>
        readFileSync(catalog(directory, locale), "utf8"),
      );
      extractFixture(directory);
      assert.deepEqual(
        ["en", "de"].map((locale) => readFileSync(catalog(directory, locale), "utf8")),
        snapshot,
      );
      for (const locale of ["en", "de"]) {
        if (migration) assertPreservedMigration(directory, locale);
        await assertCompiledOutput(directory, locale, migration);
      }
    });
  }
}

test("Lingui authoring examples extract named placeholders and deferred labels", () => {
  const examples = recipeFiles("from-lingui.md");
  const actual = [...examples].flatMap(([filename, code]) => extractMessagesNative(code, filename));
  assert.deepEqual(
    actual.map((entry) => identity(entry.message, entry.context)).sort(),
    [
      identity("Buy now", "checkout button"),
      identity("Hello {name}"),
      identity("{count, plural, one {# offer} other {# offers}}"),
    ].sort(),
  );
});
