import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { EXAMPLE_MATRIX } from "./example-matrix.mjs"

const workflow = await readFile(
  new URL("../.github/workflows/remix-next-canary.yml", import.meta.url),
  "utf8"
)

const requiredSteps = [
  'git worktree add --detach "$canary_dir" "$GITHUB_SHA"',
  "pnpm install --frozen-lockfile",
  'pnpm --filter "@palamedes/remix..." -r build',
  'pnpm --filter "@palamedes/example-remix-*" add remix@next --save-exact',
  "working-directory: ${{ steps.canary-worktree.outputs.path }}/examples/remix-cookie",
  "require('remix/package.json').version",
  "pnpm verify:examples:smoke -- --framework remix",
]

for (const step of requiredSteps) {
  assert.ok(workflow.includes(step), `remix@next canary must contain: ${step}`)
}

const buildIndex = workflow.indexOf('pnpm --filter "@palamedes/remix..." -r build')
const overrideIndex = workflow.indexOf(
  'pnpm --filter "@palamedes/example-remix-*" add remix@next --save-exact'
)
const smokeIndex = workflow.indexOf("pnpm verify:examples:smoke -- --framework remix")

assert.ok(
  buildIndex < overrideIndex,
  "workspace packages must build before remix@next is installed"
)
assert.ok(overrideIndex < smokeIndex, "remix@next must be installed before the smoke verifier runs")
assert.match(workflow, /schedule:\n[\s\S]*cron:/u, "canary must continue to detect upstream churn")
assert.match(workflow, /push:\n\s+branches:\n\s+- main/u, "canary must run after main changes")
assert.match(workflow, /workflow_dispatch:/u, "canary must be manually runnable")
assert.doesNotMatch(workflow, /continue-on-error:/u, "canary failures must remain visible")

assert.deepEqual(
  EXAMPLE_MATRIX.filter((example) => example.framework === "remix").map(
    (example) => example.strategy
  ),
  ["cookie", "route", "subdomain", "tld"],
  "the remix@next smoke verifier must cover every intended Remix strategy"
)

console.log("remix@next canary workflow contract is intact")
