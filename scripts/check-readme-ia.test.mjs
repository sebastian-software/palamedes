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

test("matches GitHub rendered heading text and global slug collisions", () => {
  const headings = `${readme}

### Under_score
### [Linked](https://example.com)
### Collision
### Collision-1
### Collision
[Underscore](#under_score)
[Rendered link text](#linked)
[Collision after an explicit suffix](#collision-2)
`

  assert.doesNotThrow(check(headings))
  assert.throws(check(`${headings}\n[Wrong underscore](#underscore)\n`), /missing anchor/u)
  assert.throws(
    check(`${headings}\n[Wrong source-derived link](#linkedhttpsexamplecom)\n`),
    /missing anchor/u
  )
})

test("removes underscore emphasis without losing literal or code underscores", () => {
  const headings = `${readme}

### _Italic_
### __Strong__
### Under_score
### \`_Code_\`
### \`\` _Spaced_ \`\`
[Italic](#italic)
[Strong](#strong)
[Literal underscore](#under_score)
[Code underscore](#_code_)
[Spaced code underscore](#_spaced_)
`

  assert.doesNotThrow(check(headings))
  assert.throws(check(`${headings}\n[Source italic](#_italic_)\n`), /missing anchor/u)
  assert.throws(check(`${headings}\n[Source strong](#__strong__)\n`), /missing anchor/u)
  assert.throws(check(`${headings}\n[Stripped code](#spaced)\n`), /missing anchor/u)
})
