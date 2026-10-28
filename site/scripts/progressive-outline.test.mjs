import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";

import {
  PROGRESSIVE_OUTLINE_MANIFEST,
  PROGRESSIVE_OUTLINE_THRESHOLD,
  REQUIRED_OUTLINE_DOCS,
  checkProgressiveOutlines,
  countTopLevelHeadings,
  usesProgressiveOutline,
  verifyGeneratedProgressiveOutlines,
} from "./progressive-outline.mjs";

const longCount = PROGRESSIVE_OUTLINE_THRESHOLD + 1;
const shortCount = PROGRESSIVE_OUTLINE_THRESHOLD;
const headings = (count) =>
  Array.from({ length: count }, (_, index) => `## Section ${index + 1}`).join("\n\n");
const outline = (count) =>
  [
    '<section className="pmds-progressive-outline">',
    ...Array.from({ length: count }, (_, index) => `<a href="#section-${index + 1}">S</a>`),
    "</section>",
  ].join("\n");
const longBody = headings(longCount);
const shortBody = headings(shortCount);
const longPage = `${outline(longCount)}\n\n${longBody}`;

let docsDir;
afterEach(() => {
  if (docsDir) rmSync(docsDir, { recursive: true, force: true });
  docsDir = undefined;
});

function writeDocs(files) {
  docsDir = mkdtempSync(join(tmpdir(), "progressive-outline-"));
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(dirname(join(docsDir, file)), { recursive: true });
    writeFileSync(join(docsDir, file), `---\ntitle: "${file}"\n---\n${content}\n`);
  }
}

function manifest(docs) {
  return {
    threshold: PROGRESSIVE_OUTLINE_THRESHOLD,
    docs: docs.map(([file, count]) => ({
      file,
      headings: count,
      outline: count > PROGRESSIVE_OUTLINE_THRESHOLD,
    })),
  };
}

test("counts only top-level headings outside code fences", () => {
  assert.equal(countTopLevelHeadings("## One\n### Nested\n```md\n## Fenced\n```\n## Two"), 2);
  assert.equal(usesProgressiveOutline("docs/cli.md", longBody), true);
  assert.equal(usesProgressiveOutline("docs/cli.md", shortBody), false);
  assert.equal(usesProgressiveOutline("adr/001.md", longBody), false);
});

test("accepts generated docs that match the manifest", () => {
  writeDocs({ "long.mdx": longPage, "api/short/index.md": shortBody });
  const result = checkProgressiveOutlines({
    docsDir,
    manifest: manifest([
      ["long.mdx", longCount],
      ["api/short/index.md", shortCount],
    ]),
  });

  assert.deepEqual(result.problems, []);
  assert.deepEqual([...result.outlined], ["long.mdx"]);
  assert.deepEqual(
    result.docs.map(({ entry }) => entry),
    ["long.mdx"],
  );
});

test("reports a long doc whose outline was not generated", () => {
  writeDocs({ "long.mdx": longBody });
  const { problems } = checkProgressiveOutlines({
    docsDir,
    manifest: manifest([["long.mdx", longCount]]),
  });

  assert.deepEqual(problems, ["long docs without a generated outline: long.mdx"]);
});

test("reports an outline the manifest does not expect", () => {
  writeDocs({ "long.mdx": longPage, "short.mdx": `${outline(shortCount)}\n\n${shortBody}` });
  const { problems } = checkProgressiveOutlines({
    docsDir,
    manifest: manifest([
      ["long.mdx", longCount],
      ["short.mdx", shortCount],
    ]),
  });

  assert.deepEqual(problems, ["outline on docs the manifest does not expect: short.mdx"]);
});

test("reports an outline that does not link every top-level heading", () => {
  writeDocs({ "long.mdx": `${outline(longCount - 1)}\n\n${longBody}` });
  const { problems } = checkProgressiveOutlines({
    docsDir,
    manifest: manifest([["long.mdx", longCount]]),
  });

  assert.deepEqual(problems, [
    `long.mdx outline links ${longCount - 1} of its ${longCount} top-level headings`,
  ]);
});

test("reports a manifest that disagrees with the generated page", () => {
  writeDocs({ "long.mdx": longPage });
  const { problems } = checkProgressiveOutlines({
    docsDir,
    manifest: manifest([
      ["long.mdx", shortCount],
      ["missing.mdx", 1],
    ]),
  });

  assert.deepEqual(problems, [
    `long.mdx has ${longCount} top-level headings, but the manifest records ${shortCount} (outline: false)`,
    "manifest entry missing.mdx has no generated page",
  ]);
});

test("reports an empty outline set", () => {
  writeDocs({ "short.mdx": shortBody });
  const { problems } = checkProgressiveOutlines({
    docsDir,
    manifest: manifest([["short.mdx", shortCount]]),
  });

  assert.deepEqual(problems, ["the prebuild gave no generated doc an outline"]);
});

test("requires the manifest and the named long guides", () => {
  writeDocs({ "long.mdx": longPage });
  const dataDir = join(docsDir, "data");
  assert.deepEqual(verifyGeneratedProgressiveOutlines({ docsDir, dataDir }).problems, [
    `the prebuild did not write ${PROGRESSIVE_OUTLINE_MANIFEST}`,
  ]);

  mkdirSync(dataDir);
  writeFileSync(
    join(dataDir, PROGRESSIVE_OUTLINE_MANIFEST),
    JSON.stringify(manifest([["long.mdx", longCount]])),
  );
  assert.deepEqual(
    verifyGeneratedProgressiveOutlines({ docsDir, dataDir }).problems,
    REQUIRED_OUTLINE_DOCS.map(
      ([file, label]) => `${label} (${file}) is missing its generated outline`,
    ),
  );
});
