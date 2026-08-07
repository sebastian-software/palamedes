import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { checkLlmsSurface } from "./check-llms-surface.mjs"
import { llmsSurfaceContract } from "./llms-surface-contract.mjs"

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..")
const source = new Map()

function read(file) {
  if (!source.has(file)) source.set(file, readFileSync(path.join(root, file), "utf8"))
  return source.get(file)
}

function withMutation(file, mutate) {
  const files = new Map(source)
  files.set(file, mutate(read(file)))
  return () => files.get.bind(files)
}

test("accepts the checked-in public surface", () => {
  assert.doesNotThrow(() => checkLlmsSurface({ read }))
})

test("rejects every required llms surface when it is omitted", () => {
  for (const surface of llmsSurfaceContract) {
    for (const [file, required] of Object.entries(surface.documents)) {
      const omitted = required[0]
      assert.throws(
        () =>
          checkLlmsSurface({
            read: withMutation(file, (text) => text.replaceAll(omitted, ""))(),
          }),
        new RegExp(`${surface.id}: ${file} is missing required surface`)
      )
    }
  }
})

test("rejects stale command flags, package names, and Node API exports", () => {
  assert.throws(
    () =>
      checkLlmsSurface({
        read: withMutation("docs/cli.md", (text) => text.replaceAll("--check", "--changed"))(),
      }),
    /extraction-drift-check: docs\/cli\.md is missing required surface: --check/
  )
  assert.throws(
    () =>
      checkLlmsSurface({
        read: withMutation("packages/eslint-plugin/package.json", (text) =>
          text.replace("@palamedes/eslint-plugin", "@palamedes/renamed-plugin")
        )(),
      }),
    /does not publish @palamedes\/eslint-plugin/
  )
  assert.throws(
    () =>
      checkLlmsSurface({
        read: withMutation("packages/core-node/src/index.ts", (text) =>
          text.replaceAll(
            "export function listTranslationCandidates",
            "function listTranslationCandidates"
          )
        )(),
      }),
    /translation-candidate-patches: packages\/core-node\/src\/index\.ts is missing required surface/
  )
})

test("accepts harmless prose and whitespace around required context", () => {
  assert.doesNotThrow(() =>
    checkLlmsSurface({
      read: withMutation(
        "llms.txt",
        (text) => `Editorial note.\n\n${text.replace("pmds lint", "pmds\n    lint")}`
      )(),
    })
  )
})
