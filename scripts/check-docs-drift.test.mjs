import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  checkDocsDrift,
  findRemovedOptionUses,
  findUnpinnedSolidInstalls,
  isDocsSurface,
  isMigrationContextFile,
  listDocsSurfaces,
  readRemovedOptionKeys,
  readSolidPins,
  REMOVED_OPTIONS_SOURCE,
  SOLID_PIN_SOURCE,
} from "./check-docs-drift.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(path.join(root, file), "utf8");
const keys = readRemovedOptionKeys(read(REMOVED_OPTIONS_SOURCE));
const pins = readSolidPins(read(SOLID_PIN_SOURCE));
const fence = "```";

test("reads every removed option from the core-node migration table", () => {
  assert.deepEqual(keys, [
    "failOnCompileError",
    "keepSourceFallbacks",
    "stripMessageField",
    "messageSplitting",
    "experimentalGraphSplitting",
    "cwd",
  ]);
  assert.throws(() => readRemovedOptionKeys("export const OTHER = {};"), /no longer declares/u);
});

test("reads exact Solid pins from the maintained example", () => {
  const manifest = JSON.parse(read(SOLID_PIN_SOURCE));
  assert.equal(pins["solid-js"], manifest.dependencies["solid-js"]);
  assert.equal(pins["@solidjs/web"], manifest.dependencies["@solidjs/web"]);
  assert.equal(pins["@solidjs/vite-plugin"], manifest.devDependencies["@solidjs/vite-plugin"]);
  assert.throws(
    () =>
      readSolidPins(
        JSON.stringify({
          dependencies: {
            "solid-js": "^2.0.0",
            "@solidjs/web": "2.0.0",
            "@solidjs/router": "1.0.0",
          },
          devDependencies: { "@solidjs/vite-plugin": "3.0.0" },
        }),
      ),
    /exact version/u,
  );
});

test("flags removed options set in code or described as current", () => {
  const cases = [
    `${fence}ts\npalamedes({\n  cwd: process.cwd(),\n});\n${fence}`,
    `${fence}ts\ncreatePalamedesRemixCatalogAssetRegistry({ cwd: import.meta.dirname });\n${fence}`,
    `${fence}ts\nconst cwd = root;\npalamedes({ cwd });\n${fence}`,
    "Set `projectRoot` in a custom host. `cwd` is a deprecated alias.",
    "`cwd` and `skipValidation` are passed through to `loadPalamedesConfig`: `cwd`\nsets the directory the config search starts from.",
    `${fence}js\nwithPalamedes({}, { keepSourceFallbacks: true });\n${fence}`,
    `${fence}tsx\n<Palamedes failOnCompileError={false} />\n${fence}`,
    "- Set `messageSplitting: false` to keep one catalog per locale.",
  ];
  for (const text of cases) {
    assert.notDeepEqual(findRemovedOptionUses(text, keys), [], text);
  }
  assert.deepEqual(
    findRemovedOptionUses(
      `Intro.\n\n${fence}ts\npalamedes({\n  cwd: process.cwd(),\n});\n${fence}`,
      keys,
    ),
    [{ key: "cwd", line: 5 }],
  );
});

test("allows migration guidance and APIs that still accept the name", () => {
  const cases = [
    "The plugin throws a migration error for the removed v1 options\n`failOnCompileError` and `cwd` (now `projectRoot`).",
    "- `projectRoot` (renamed from `cwd`, which throws a migration error) is the base.",
    "| `cwd` (Vite, Next.js) | Rename it to `projectRoot`. |",
    "Its v1 name `keepSourceFallbacks` is rejected.",
    "## `loadPalamedesConfig(options?)`\n\nOptions include `cwd`, `configPath`, and `skipValidation`.",
    `${fence}ts\nconst config = await loadPalamedesConfig({ cwd: process.cwd() });\n${fence}`,
    `${fence}ts\nexecFileSync("pmds", ["extract"], { cwd: directory });\n${fence}`,
    "Run it from `process.cwd()` or pass `projectRoot`.",
    `${fence}ts\nconst root = process.cwd();\n${fence}`,
    `${fence}ts\nconst cwd = path.dirname(file);\n${fence}`,
  ];
  for (const text of cases) {
    assert.deepEqual(findRemovedOptionUses(text, keys), [], text);
  }
});

test("treats list items and table rows as separate blocks", () => {
  const list = "- `cwd` sets the search root.\n- `keepSourceFallbacks` was renamed.";
  assert.deepEqual(findRemovedOptionUses(list, keys), [{ key: "cwd", line: 1 }]);
  const table = "| Option | Status |\n| `cwd` | current |\n| `failOnCompileError` | removed |";
  assert.deepEqual(findRemovedOptionUses(table, keys), [{ key: "cwd", line: 2 }]);
});

test("requires the example's pins on every Solid install command", () => {
  const unpinned = findUnpinnedSolidInstalls(
    "pnpm add @palamedes/solid @solidjs/web solid-js\npnpm add -D @solidjs/vite-plugin",
    pins,
  );
  assert.deepEqual(
    unpinned.map(({ line, found }) => [line, found]),
    [
      [1, "@solidjs/web"],
      [1, "solid-js"],
      [2, "@solidjs/vite-plugin"],
    ],
  );
  assert.deepEqual(
    findUnpinnedSolidInstalls("npm install solid-js@2.0.0-rc.3 @solidjs/router@next", pins).map(
      ({ found, expected }) => [found, expected],
    ),
    [
      ["solid-js@2.0.0-rc.3", `solid-js@${pins["solid-js"]}`],
      ["@solidjs/router@next", `@solidjs/router@${pins["@solidjs/router"]}`],
    ],
  );
  const pinned = `pnpm add @palamedes/solid @solidjs/web@${pins["@solidjs/web"]} solid-js@${pins["solid-js"]}\npnpm add -D @solidjs/vite-plugin@${pins["@solidjs/vite-plugin"]}`;
  assert.deepEqual(findUnpinnedSolidInstalls(pinned, pins), []);
  assert.deepEqual(
    findUnpinnedSolidInstalls("Solid apps import `solid-js` and `@solidjs/web`.", pins),
    [],
  );
});

test("scopes the guard to npm-facing docs and exempts migration files", () => {
  assert.ok(isDocsSurface("README.md"));
  assert.ok(isDocsSurface("packages/vite-plugin/README.md"));
  assert.ok(isDocsSurface("llms-full.txt"));
  assert.ok(isDocsSurface("docs/api/remix.md"));
  assert.ok(isDocsSurface("skills/palamedes/references/vite-react.md"));
  assert.ok(!isDocsSurface("packages/vite-plugin/src/index.ts"));
  assert.ok(!isDocsSurface("adr/029-effective-flow-project-setup.md"));

  assert.ok(isMigrationContextFile("docs/migration-v2.md"));
  assert.ok(isMigrationContextFile("docs/release-notes-v2.md"));
  assert.ok(isMigrationContextFile("docs/troubleshooting.md"));
  assert.ok(isMigrationContextFile("packages/core/CHANGELOG.md"));
  assert.ok(!isMigrationContextFile("packages/vite-plugin/README.md"));
  assert.ok(!isMigrationContextFile("llms.txt"));
});

test("the repository docs pass, and a reintroduced regression fails", () => {
  const files = listDocsSurfaces(root);
  assert.ok(files.includes("llms.txt"));
  assert.ok(files.includes("packages/remix/README.md"));
  assert.deepEqual(checkDocsDrift({ files, read }), []);

  const mutated = (file) =>
    file === "packages/vite-plugin/README.md"
      ? `${read(file)}\n${fence}ts\npalamedes({ cwd: process.cwd() });\n${fence}\n\npnpm add solid-js\n`
      : file === "docs/migration-v2.md"
        ? `${read(file)}\n${fence}ts\npalamedes({ cwd: process.cwd() });\n${fence}\n`
        : read(file);
  const problems = checkDocsDrift({
    files: ["packages/vite-plugin/README.md", "docs/migration-v2.md"],
    read: mutated,
  });
  assert.equal(problems.length, 2, problems.join("\n"));
  assert.match(
    problems[0],
    /^packages\/vite-plugin\/README\.md:\d+ uses the removed option `cwd`/u,
  );
  assert.match(problems[1], /^packages\/vite-plugin\/README\.md:\d+ installs `solid-js`/u);
});
