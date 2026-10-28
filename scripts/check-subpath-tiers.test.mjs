import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkSubpathTiers,
  collectPackageSubpaths,
  parseSubpathTierTable,
} from "./check-subpath-tiers.mjs";

function doc(rows) {
  return [
    "# Stability",
    "",
    "## Subpath Tiers",
    "",
    "| Subpath | Tier | Notes |",
    "| ------- | ---- | ----- |",
    ...rows,
    "",
    "## Stable Surfaces",
    "",
    "| Subpath | Tier | Notes |",
    "| `@palamedes/ignored/after-section` | Stable | Outside the section. |",
  ].join("\n");
}

const packages = [
  {
    name: "@palamedes/core",
    manifest: { exports: { ".": "./a.js", "./compiled": "./b.js", "./package.json": "./p" } },
  },
  {
    name: "@palamedes/remix",
    manifest: { exports: { ".": "./a.js", "./server": "./s.js", "./client": "./c.js" } },
  },
  {
    name: "@palamedes/next-plugin",
    manifest: { exports: { ".": "./a.js", "./server": "./s.js", "./loader": "./l.cjs" } },
  },
  { name: "@palamedes/cli", manifest: { bin: { pmds: "./bin" } } },
];

const matchingRows = [
  "| `@palamedes/core/compiled` | Stable | Alias. |",
  "| `@palamedes/remix/server`, `/client` | Stable | Server and browser entries. |",
  "| `@palamedes/next-plugin/server` | Stable | Server factory. |",
  "| Other `@palamedes/next-plugin/*` subpaths | Internal | Loaders. |",
];

test("collects subpaths without package roots or package.json", () => {
  const { roots, subpaths } = collectPackageSubpaths(packages);
  assert.deepEqual([...roots].sort(), [
    "@palamedes/core",
    "@palamedes/next-plugin",
    "@palamedes/remix",
  ]);
  assert.deepEqual(subpaths, [
    "@palamedes/core/compiled",
    "@palamedes/next-plugin/loader",
    "@palamedes/next-plugin/server",
    "@palamedes/remix/client",
    "@palamedes/remix/server",
  ]);
});

test("expands continuation spans and stops at the next section", () => {
  const { entries, wildcards } = parseSubpathTierTable(doc(matchingRows));
  assert.deepEqual(
    entries.map(({ specifier, tier }) => `${specifier}:${tier}`),
    [
      "@palamedes/core/compiled:Stable",
      "@palamedes/remix/server:Stable",
      "@palamedes/remix/client:Stable",
      "@palamedes/next-plugin/server:Stable",
    ],
  );
  assert.deepEqual(
    wildcards.map(({ packageName, tier }) => `${packageName}:${tier}`),
    ["@palamedes/next-plugin:Internal"],
  );
});

test("passes when every subpath has a row and every row is exported", () => {
  assert.deepEqual(checkSubpathTiers({ packages, markdown: doc(matchingRows) }), []);
});

test("reports an exported subpath without a row", () => {
  const rows = matchingRows.filter((row) => !row.includes("core/compiled"));
  assert.deepEqual(checkSubpathTiers({ packages, markdown: doc(rows) }), [
    "@palamedes/core/compiled is exported but has no row in the subpath tier table.",
  ]);
});

test("reports rows for subpaths and packages that nothing exports", () => {
  const rows = [
    ...matchingRows,
    "| `@palamedes/core/removed` | Stable | Gone. |",
    "| `@palamedes/missing` | Stable | No such package. |",
    "| Other `@palamedes/remix/*` subpaths | Internal | Nothing left. |",
  ];
  assert.deepEqual(checkSubpathTiers({ packages, markdown: doc(rows) }), [
    "@palamedes/core/removed is listed in the subpath tier table but no package exports it.",
    "@palamedes/missing is listed in the subpath tier table but no package exports it.",
    '"Other @palamedes/remix/* subpaths" covers no exported subpath.',
  ]);
});

test("reports duplicate rows", () => {
  const rows = [...matchingRows, "| `@palamedes/core/compiled` | Stable | Again. |"];
  assert.deepEqual(checkSubpathTiers({ packages, markdown: doc(rows) }), [
    "@palamedes/core/compiled is listed more than once.",
  ]);
});

test("rejects unknown tiers and a missing table", () => {
  assert.throws(
    () => parseSubpathTierTable(doc(["| `@palamedes/core/compiled` | Beta | Unknown. |"])),
    /has tier "Beta"; use one of Stable, Preview, Internal, Reserved/u,
  );
  assert.throws(() => parseSubpathTierTable("# Stability\n"), /no "## Subpath Tiers" section/u);
});
