import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { checkLlmsSurface } from "./check-llms-surface.mjs"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const source = new Map()

function read(file) {
  if (!source.has(file)) source.set(file, readFileSync(path.join(root, file), "utf8"))
  return source.get(file)
}

function withMutation(file, mutate) {
  const files = new Map(source)
  files.set(file, mutate(read(file)))
  return (requested) => files.get(requested) ?? read(requested)
}

function expectRejected(file, mutate, expected) {
  assert.throws(() => checkLlmsSurface({ read: withMutation(file, mutate) }), expected)
}

test("accepts the checked-in public surface", () => {
  assert.doesNotThrow(() => checkLlmsSurface({ read }))
})

test("rejects a renamed implemented lint flag", () => {
  expectRejected(
    "crates/palamedes-cli/src/commands/lint.rs",
    (text) => text.replace("fail_on: LintFailOn", "threshold: LintFailOn"),
    /missing required surface: --threshold/
  )
})

test("rejects an unclassified built-in command", () => {
  expectRejected(
    "crates/palamedes-cli/src/cli.rs",
    (text) =>
      text.replace("    Version,", "    Version,\n    /// Scan catalogs.\n    Scan(ScanOptions),"),
    /Built-in pmds command inventory changed/
  )
})

test("rejects a renamed published package outside the compact inventory", () => {
  expectRejected(
    "packages/react/package.json",
    (text) => text.replace("@palamedes/react", "@palamedes/react-renamed"),
    /Published package inventory changed/
  )
})

test("rejects a removed translation patch type", () => {
  expectRejected(
    "packages/core-node/src/index.ts",
    (text) => text.replace("export type TranslationPatch =", "type TranslationPatch ="),
    /Translation candidate\/patch API inventory changed/
  )
})

test("rejects a missing translation patch outcome from full context", () => {
  expectRejected(
    "llms-full.txt",
    (text) => text.replaceAll("notApplied", ""),
    /translation patch outcomes: llms-full\.txt is missing required surface: notApplied/
  )
})

test("accepts harmless Markdown heading-layout changes", () => {
  assert.doesNotThrow(() =>
    checkLlmsSurface({
      read: withMutation("docs/cli.md", (text) =>
        text.replace("## `pmds lint`", "### Source lint")
      ),
    })
  )
})
