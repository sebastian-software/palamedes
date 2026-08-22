import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

function read(file) {
  return readFileSync(join(root, file), "utf8")
}

function assertIncludes(file, value) {
  assert.ok(read(file).includes(value), `${file} must include ${JSON.stringify(value)}`)
}

test("Next.js first run keeps its executable server path and navigation in sync", () => {
  const guide = "docs/nextjs-first-run.md"
  assert.ok(existsSync(join(root, guide)), `${guide} must exist`)

  for (const value of [
    'import { withPalamedes } from "@palamedes/next-plugin"',
    'import { createNextServerI18nScope } from "@palamedes/next-plugin/server"',
    'import { createI18n } from "@palamedes/core/compiled"',
    'import type { CompiledCatalogMessages } from "@palamedes/core/compiled"',
    "serverI18nScope.run(i18n, callback)",
    "pnpm exec pmds extract",
    "messageSplitting: true",
    "serverFunctions: true",
  ]) {
    assertIncludes(guide, value)
  }
  assert.ok(
    !read(guide).includes('from "@/lib/i18n.server"'),
    "the guide must not require an app alias"
  )

  for (const file of ["README.md", "llms.txt", "llms-full.txt", "packages/next-plugin/README.md"]) {
    assertIncludes(file, "docs/nextjs-first-run.md")
  }
  assertIncludes("site/scripts/prebuild-content.mjs", '"nextjs-first-run.md", 12')
  assertIncludes("scripts/verify-site-routes.mjs", 'path: "/docs/nextjs-first-run"')
})
