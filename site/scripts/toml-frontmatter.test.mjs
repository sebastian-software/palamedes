import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const ardoEntry = import.meta.resolve("ardo/vite");
const requireFromArdo = createRequire(ardoEntry);
const remarkMdxFrontmatterEntry = requireFromArdo.resolve("remark-mdx-frontmatter");
const requireFromRemarkMdxFrontmatter = createRequire(remarkMdxFrontmatterEntry);
const toml = requireFromRemarkMdxFrontmatter("toml");

test("Ardo compiles TOML frontmatter with the patched parser", async () => {
  const { compile } = await import(pathToFileURL(requireFromArdo.resolve("@mdx-js/mdx")).href);
  const remarkFrontmatter = (
    await import(pathToFileURL(requireFromArdo.resolve("remark-frontmatter")).href)
  ).default;
  const remarkMdxFrontmatter = (await import(pathToFileURL(remarkMdxFrontmatterEntry).href))
    .default;

  const output = String(
    await compile(
      `+++
title = "Patched parser"
tags = ["security", "docs"]

[publisher]
name = "Palamedes"
+++
# Hello`,
      {
        remarkPlugins: [
          [remarkFrontmatter, ["toml"]],
          [remarkMdxFrontmatter, { name: "frontmatter" }],
        ],
      },
    ),
  );

  assert.match(output, /"title": "Patched parser"/);
  assert.match(output, /"tags": \["security", "docs"\]/);
  assert.match(output, /"publisher": \{/);
});

test("TOML parsing blocks prototype traversal", () => {
  const payload = `[a.b]
y = 1
[a.b.y.__proto__.__proto__]
polluted = "yes"`;

  try {
    assert.throws(() => toml.parse(payload));
    assert.equal(Object.prototype.polluted, undefined);
  } finally {
    delete Object.prototype.polluted;
  }
});

test("TOML parsing rejects excessive nesting with a catchable parse error", () => {
  const depth = 600;
  const payload = `value=${"[".repeat(depth)}1${"]".repeat(depth)}`;

  assert.throws(
    () => toml.parse(payload),
    (error) =>
      !(error instanceof RangeError) &&
      error instanceof Error &&
      error.message.includes("Maximum nesting depth"),
  );
});

test("TOML parsing blocks quoted-key collisions from reopening date values", () => {
  // GHSA-h895-cgqg-jf52 bypassed the older prototype traversal guard.
  const payload = `"b.c" = 1979-05-27T07:32:00Z
[['"b']]
["b.c"]
__proto__.__proto__.polluted = "yes"`;

  try {
    assert.throws(() => toml.parse(payload));
    assert.equal(Object.prototype.polluted, undefined);
  } finally {
    delete Object.prototype.polluted;
  }
});

test("TOML frontmatter integers retain number semantics and reject precision loss", () => {
  assert.equal(toml.parse("count = 9007199254740991").count, Number.MAX_SAFE_INTEGER);
  assert.throws(() => toml.parse("count = 9007199254740993"), /losslessly/);
  assert.throws(() => toml.parse("count = 9223372036854775808"), /64-bit signed integer range/);
});
