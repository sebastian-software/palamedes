import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import { checkReadmeInformationArchitecture } from "./check-readme-ia.mjs"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const readme = readFileSync(join(root, "README.md"), "utf8")

function check(markdown, exists = existsSync) {
  return () =>
    checkReadmeInformationArchitecture({
      read: (file) => (file === "README.md" ? markdown : readFileSync(join(root, file), "utf8")),
      exists,
    })
}

test("accepts the checked-in README information architecture", () => {
  assert.doesNotThrow(check(readme))
})

test("rejects proof that moves ahead of the actionable start", () => {
  const moved = readme
    .replace("## Start Here", "## Temporary Heading")
    .replace("## Proof You Can Inspect", "## Start Here")
    .replace("## Temporary Heading", "## Proof You Can Inspect")
  assert.throws(check(moved), /Start Here must precede proof/)
})

test("rejects drift between the compact and detailed install paths", () => {
  const detailedStart = readme.indexOf("## Quick Start With Vite")
  const drifted = `${readme.slice(0, detailedStart)}${readme
    .slice(detailedStart)
    .replace("pnpm add -D @palamedes/cli", "pnpm add -D @palamedes/cli-renamed")}`
  assert.throws(check(drifted), /detailed Vite quickstart drifted/)
})

test("rejects broken repository links and anchors", () => {
  assert.throws(
    check(`${readme}\n[Missing guide](docs/missing-quickstart.md)\n`),
    /missing repository path/
  )
  assert.throws(check(`${readme}\n[Missing section](#missing-proof)\n`), /missing anchor/)
})

test("ignores headings and links inside GFM fenced code blocks", () => {
  const fencedOnlyStart = `${readme.replace("## Start Here", "## Start Elsewhere")}
\n~~~markdown
## Start Here
[Missing guide](docs/missing-from-fence.md)
~~~
`
  assert.throws(check(fencedOnlyStart), /missing Start Here/u)

  assert.doesNotThrow(
    check(`${readme}
\n\`\`\`markdown
[Missing guide](docs/missing-from-fence.md)
\`\`\`
`)
  )
})

test("does not accept a fenced heading as a GitHub anchor", () => {
  assert.throws(check(`${readme}\n[Ghost](#palamedesyaml)\n`), /missing anchor/u)
})

test("matches GitHub duplicate-heading suffixes", () => {
  assert.doesNotThrow(
    check(`${readme}
\n### Repeated
### Repeated
[Second repeated heading](#repeated-1)
`)
  )
})
