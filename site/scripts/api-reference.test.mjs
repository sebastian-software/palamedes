import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  generatePackageApiReference,
  normalizeApiPage,
  publicApiImportPath,
} from "./api-reference.mjs";

async function writeManifest(directory, name, exports) {
  const root = path.join(directory, "packages", name);
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: `@palamedes/${name}`, exports }),
  );
}

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

test("each public entry receives a complete reference and documented import path", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "palamedes-api-reference-"));
  try {
    const calls = [];
    await writeManifest(directory, "core", {
      ".": "./dist/index.d.mts",
      "./locale": "./dist/locale.d.mts",
    });
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
        return {
          pages: [
            {
              path: "index.md",
              frontmatter: { title: config.title },
              content: `# ${config.title}\n\n## Functions\n\n- defineLocaleControls\n`,
            },
          ],
        };
      },
    );
    assert.equal(calls.length, 2);
    assert.equal(calls[0].entryPoints.length, 1);
    assert.equal(calls[1].out, "api-reference/core/modules/locale");
    assert.equal(calls[1].importPaths[0], "@palamedes/core/locale");
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

test("entry module URLs stay lowercase while labels keep the export name", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "palamedes-api-reference-"));
  try {
    const calls = [];
    await writeManifest(directory, "transform", {
      ".": "./dist/index.d.mts",
      "./catalog-loader": "./dist/catalogLoader.d.mts",
    });
    await generatePackageApiReference(
      {
        slug: "transform",
        label: "Transform",
        position: 10,
        entryPoints: ["packages/transform/src/index.ts", "packages/transform/src/catalogLoader.ts"],
      },
      directory,
      directory,
      async (config) => {
        calls.push(config);
        return {
          pages: [
            {
              path: "index.md",
              frontmatter: { title: config.title },
              content: `# ${config.title}\n`,
            },
          ],
        };
      },
    );
    assert.equal(calls[1].out, "api-reference/transform/modules/catalogloader");
    assert.equal(calls[1].title, "Transform / catalogLoader API");
    assert.match(
      await readFile(path.join(directory, "api-reference/transform/index.md"), "utf8"),
      /\[catalogLoader\]\(\/api-reference\/transform\/modules\/catalogloader\)/u,
    );
    await readFile(
      path.join(directory, "api-reference/transform/modules/catalogloader/index.md"),
      "utf8",
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

test("the CLI reference points to commands instead of an empty JavaScript API", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "palamedes-cli-reference-"));
  try {
    await generatePackageApiReference(
      { slug: "cli", label: "CLI", guide: "/docs/cli" },
      directory,
      directory,
      () => {
        throw new Error("CLI has no declaration API");
      },
    );
    assert.match(
      await readFile(path.join(directory, "api-reference/cli/index.md"), "utf8"),
      /\[Read the CLI reference\]\(\/docs\/cli\)/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("native API pages describe declarations and their public import paths", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "palamedes-native-api-"));
  try {
    await writeManifest(directory, "example", { ".": "./dist/index.d.ts" });
    await mkdir(path.join(directory, "packages/example/dist"), { recursive: true });
    await writeFile(
      path.join(directory, "packages/example/dist/index.d.ts"),
      `/** Return a translated greeting. */
export declare function greeting(name: string): string;
`,
    );
    await generatePackageApiReference(
      { slug: "example", label: "Example", entryPoints: ["packages/example/src/index.ts"] },
      directory,
      directory,
    );
    const page = await readFile(
      path.join(directory, "api-reference/example/functions/greeting.md"),
      "utf8",
    );
    assert.match(page, /@palamedes\/example/u);
    assert.match(page, /name/u);
    assert.match(page, /Return a translated greeting/u);
    assert.match(page, /Source entry on GitHub/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("public import paths follow conditional exports rather than source filenames", () => {
  const manifest = {
    name: "@palamedes/runtime",
    exports: { "./server/bundled": { import: { types: "./dist/server-bundled.d.mts" } } },
  };
  assert.equal(
    publicApiImportPath(manifest, "./dist/server-bundled.d.mts"),
    "@palamedes/runtime/server/bundled",
  );
  assert.throws(() => publicApiImportPath(manifest, "./dist/internal.d.mts"), /No public export/u);
});
