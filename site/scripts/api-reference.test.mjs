import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  generatePackageApiReference,
  normalizeApiPage,
  repairSourceLinks,
  repairApiLinks,
} from "./api-reference.mjs";

test("API pages have entry-specific metadata and one rendered main heading", () => {
  const doc = {
    path: "functions/index.md",
    frontmatter: { title: "Functions" },
    content: "# Functions\n\n## createI18n\n\nA function.\n",
  };
  const core = normalizeApiPage(doc, "Core");
  const locale = normalizeApiPage(doc, "Core / locale");
  assert.notEqual(core.frontmatter.title, locale.frontmatter.title);
  assert.notEqual(core.frontmatter.description, locale.frontmatter.description);
  assert.doesNotMatch(core.content, /^# /mu);
  assert.match(core.content, /^## createI18n/mu);
});

test("each public entry receives a complete reference and repository-relative source base", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "palamedes-api-reference-"));
  try {
    const calls = [];
    await generatePackageApiReference(
      {
        slug: "core",
        label: "Core",
        position: 10,
        entryPoints: ["packages/core/src/index.ts", "packages/core/src/locale.ts"],
      },
      directory,
      directory,
      async (config) => {
        calls.push(config);
        return [
          {
            path: "index.md",
            frontmatter: { title: config.sidebar.title },
            content: `# ${config.sidebar.title}\n\n## Functions\n\n- defineLocaleControls\n`,
          },
        ];
      },
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0].entryPoints.length, 1);
    assert.equal(calls[1].out, "api-reference/core/modules/locale");
    assert.equal(
      calls[1].markdown.sourceBaseUrl,
      "https://github.com/sebastian-software/palamedes/blob/main/packages/core/src",
    );
    assert.match(
      await readFile(path.join(directory, "api-reference/core/index.md"), "utf8"),
      /\[locale\]\(\/api-reference\/core\/modules\/locale\)/u,
    );
    assert.match(
      await readFile(path.join(directory, "api-reference/core/modules/locale/index.md"), "utf8"),
      /defineLocaleControls/u,
    );
    assert.match(
      await readFile(path.join(directory, "api-reference/core/modules/index/index.md"), "utf8"),
      /\[Open the Core API reference\]\(\/api-reference\/core\)/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("breadcrumbs do not leave a second main heading and fenced examples stay intact", () => {
  const doc = normalizeApiPage(
    {
      path: "variables/value.md",
      frontmatter: { title: "Value" },
      content: "[API](/api-reference/core)\n\n# Variable: Value\n\n```md\n# Example\n```",
    },
    "Core",
  );
  assert.doesNotMatch(doc.content, /^# Variable/mu);
  assert.match(doc.content, /```md\n# Example/u);
});

test("source links resolve shared files and never reuse declaration line numbers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "palamedes-api-sources-"));
  try {
    await mkdir(path.join(root, "packages/react/src"), { recursive: true });
    await mkdir(path.join(root, "packages/core/src"), { recursive: true });
    await writeFile(path.join(root, "packages/react/src/compiled.tsx"), "// source");
    await writeFile(path.join(root, "packages/core/src/locale.ts"), "// source");
    const base = "https://github.com/sebastian-software/palamedes/blob/main/packages/react/src/";
    const content = `[Source](${base}react/src/compiled.tsx#L9)\n[Source](${base}core/dist/locale.d.mts#L40)`;
    assert.equal(
      repairSourceLinks(content, "packages/react/src/index.tsx", root),
      "[Source](https://github.com/sebastian-software/palamedes/blob/main/packages/react/src/compiled.tsx#L9)\n[Source file](https://github.com/sebastian-software/palamedes/blob/main/packages/core/src/locale.ts)",
    );
    assert.throws(
      () =>
        repairSourceLinks(`[Source](${base}missing.ts#L1)`, "packages/react/src/index.tsx", root),
      /Cannot resolve generated API source/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("component navigation follows emitted paths rather than TypeDoc's generic kind", () => {
  const docs = [
    { path: "index.md" },
    { path: "components/plural.md" },
    { path: "components/trans.md" },
  ];
  assert.equal(
    repairApiLinks(
      "[Next](/api-reference/react/other/trans) [Plural](/api-reference/react/components/plural#usage)",
      docs,
      "api-reference/react",
    ),
    "[Next](/api-reference/react/components/trans) [Plural](/api-reference/react/components/plural#usage)",
  );
});

test("the page header owns the summary instead of repeating it in the body", () => {
  const doc = normalizeApiPage(
    {
      path: "index.md",
      frontmatter: { title: "Core", description: "Create compiled translations." },
      content: "# Core\n\nCreate compiled translations.\n\n## Functions\n- createI18n",
    },
    "Core",
  );
  assert.doesNotMatch(doc.content, /Create compiled translations/u);
  assert.match(doc.frontmatter.description, /Create compiled translations/u);
  assert.match(doc.content, /## Functions/u);
});
