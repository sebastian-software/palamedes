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

function productionPnpmPackages(file) {
  const installBlock = read(file).match(
    /^## (?:1\. Install the packages|Installation)\n\n```bash\n(?<commands>[\s\S]*?)\n```/mu
  )
  assert.ok(installBlock?.groups?.commands, `${file} must have a canonical install block`)

  const productionCommand = installBlock.groups.commands
    .split("\n")
    .find((line) => line.startsWith("pnpm add ") && !line.startsWith("pnpm add -D "))
  assert.ok(productionCommand, `${file} must have a runtime install command`)

  return new Set(productionCommand.slice("pnpm add ".length).trim().split(/\s+/u))
}

test("Next.js setup installs its standalone server boundary dependency", () => {
  for (const file of ["docs/nextjs-first-run.md", "packages/next-plugin/README.md"]) {
    assertIncludes(file, 'import "server-only"')
    assert.ok(
      productionPnpmPackages(file).has("server-only"),
      `${file} must install server-only as a runtime dependency`
    )
  }
})

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

  const siteSteps = "site/app/data/steps.ts"
  assertIncludes(
    siteSteps,
    `// src/app/page.tsx
import { t } from "@palamedes/core/macro"
import { createActiveServerI18n, runWithServerI18n } from "../lib/load-i18n.server"`
  )
  assert.ok(
    !read(siteSteps).includes('from "@/lib/load-i18n.server"'),
    "the site quickstart must not require an app alias"
  )

  for (const file of ["README.md", "llms.txt", "llms-full.txt", "packages/next-plugin/README.md"]) {
    assertIncludes(file, "docs/nextjs-first-run.md")
  }
  assertIncludes("site/scripts/prebuild-content.mjs", '"nextjs-first-run.md", 12')
  assertIncludes("scripts/verify-site-routes.mjs", 'path: "/docs/nextjs-first-run"')
})
