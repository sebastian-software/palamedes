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

test("rejects a quickstart that uses the parser-carrying runtime for generated catalogs", () => {
  expectRejected(
    "llms.txt",
    (text) =>
      text.replace(
        'import { createI18n } from "@palamedes/core/compiled"',
        'import { createI18n } from "@palamedes/core"'
      ),
    /llms\.txt quickstart runtime is missing required surface/
  )
})

test("rejects a quickstart that loses the compiled .po module type", () => {
  expectRejected(
    "docs/first-working-translation.md",
    (text) => text.replace("CompiledCatalogMessages", "CatalogMessages"),
    /docs\/first-working-translation\.md quickstart \.po declaration/
  )
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

test("accepts reordered options, alternate conflict-strategy spelling, and wrapped merge drivers", () => {
  assert.doesNotThrow(() =>
    checkLlmsSurface({
      read: withMutation("llms.txt", (text) =>
        text.replace(
          "pmds catalog merge-driver %O %A %B %A --path %P --conflict-strategy=use-first",
          "pmds catalog merge-driver --path=%P \\   \n            %O %A %B %A \\ \n            --conflict-strategy use-first"
        )
      ),
    })
  )
})

test("ignores merge-driver prose outside command examples", () => {
  assert.doesNotThrow(() =>
    checkLlmsSurface({
      read: withMutation(
        "llms.txt",
        (text) =>
          `${text}\nProse may mention pmds catalog merge-driver --format po without configuring Git.`
      ),
    })
  )
})

test("rejects hard-coded merge-driver formats in either spelling and any option order", () => {
  for (const command of [
    "pmds catalog merge-driver --format=po %O %A %B %A --path %P",
    "pmds catalog merge-driver --path %P %O %A %B %A --format fcl",
  ]) {
    expectRejected(
      "llms.txt",
      (text) =>
        text.replace(
          "pmds catalog merge-driver %O %A %B %A --path %P --conflict-strategy=use-first",
          command
        ),
      /llms\.txt must not hard-code a merge-driver format/
    )
  }
})

test("rejects a stale command even when a canonical command remains elsewhere", () => {
  expectRejected(
    "llms-full.txt",
    (text) => `${text}\n\`pmds catalog merge-driver %O %A %B %A --format po --path %P\``,
    /llms-full\.txt must not hard-code a merge-driver format/
  )
})

test("does not borrow placeholders from a later command in the same fenced example", () => {
  expectRejected(
    "llms.txt",
    (text) =>
      `${text}\n\`\`\`sh\npmds catalog merge-driver --path %P\nprintf '%O %A %B %A'\n\`\`\``,
    /llms\.txt merge-driver guidance must pass Git placeholders %O %A %B %A/
  )
})

test("does not treat an unrelated later catalog command as a merge-driver option", () => {
  assert.doesNotThrow(() =>
    checkLlmsSurface({
      read: withMutation(
        "llms.txt",
        (text) =>
          `${text}\n\`\`\`sh\npmds catalog merge-driver %O %A %B %A --path %P\npmds catalog merge --format po\n\`\`\``
      ),
    })
  )
})

test("does not join an escaped trailing backslash with the next shell line", () => {
  expectRejected(
    "llms.txt",
    (text) => `${text}\n\`\`\`sh\npmds catalog merge-driver --path %P \\\\\n%O %A %B %A\n\`\`\``,
    /llms\.txt merge-driver guidance must pass Git placeholders %O %A %B %A/
  )
})

test("requires the logical path and Git placeholder contract for every merge driver", () => {
  expectRejected(
    "llms.txt",
    (text) => text.replace("--path %P ", ""),
    /llms\.txt merge-driver guidance must pass --path %P/
  )
  expectRejected(
    "llms.txt",
    (text) => text.replace("%O %A %B %A", "%O %B %A %A"),
    /llms\.txt merge-driver guidance must pass Git placeholders %O %A %B %A/
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
