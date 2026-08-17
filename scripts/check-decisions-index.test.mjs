import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { checkDecisionsIndex } from "./check-decisions-index.mjs"

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

test("accepts the checked-in ADR index", () => {
  assert.doesNotThrow(() => checkDecisionsIndex({ read }))
})

test("rejects an ADR missing from the index", () => {
  assert.throws(
    () =>
      checkDecisionsIndex({
        read: withMutation("DECISIONS.md", (text) =>
          text.replace(
            "25. [ADR-025: React Router RSC Entry Request Scope](./adr/025-react-router-rsc-entry-request-scope.md)\n",
            ""
          )
        ),
      }),
    /DECISIONS\.md indexes \d+ ADRs, but adr\/ contains \d+/
  )
})

test("rejects a title that does not match its ADR heading", () => {
  assert.throws(
    () =>
      checkDecisionsIndex({
        read: withMutation("DECISIONS.md", (text) =>
          text.replace("Host Explicit Binary CLI Plugins In Rust", "Host Plugins in npm")
        ),
      }),
    /DECISIONS\.md title for adr\/017-cli-plugin-execution-boundary\.md must match its ADR heading/
  )
})
