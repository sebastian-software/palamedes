import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"
import { EXAMPLE_MATRIX } from "./example-matrix.mjs"

const require = createRequire(new URL("../packages/config/package.json", import.meta.url))
const { parseDocument } = require("yaml")

export const CANARY_WORKTREE = "${{ steps.canary-worktree.outputs.path }}"
export const ORDERED_STEP_IDS = [
  "canary-worktree",
  "install-dependencies",
  "build-workspace",
  "install-remix-next",
  "remix-next-version",
  "remix-next-smoke",
]

export function parseWorkflow(source) {
  const document = parseDocument(source)
  assert.equal(
    document.errors.length,
    0,
    `invalid Remix canary YAML: ${document.errors.join("; ")}`
  )
  return document.toJS()
}

function canarySteps(workflow) {
  const steps = workflow?.jobs?.["remix-next-canary"]?.steps
  assert.ok(Array.isArray(steps), "remix@next canary job must define steps")
  return steps
}

function findStep(steps, id) {
  const step = steps.find((candidate) => candidate.id === id)
  assert.ok(step, `remix@next canary must define step ${id}`)
  return step
}

function stepIndex(steps, id) {
  const index = steps.findIndex((step) => step.id === id)
  assert.notEqual(index, -1, `remix@next canary must define step ${id}`)
  return index
}

function assertSetupBootstrap(steps) {
  const node = steps.find((step) => step.name === "Set up Node.js")
  const corepack = steps.find((step) => step.name === "Enable Corepack")
  const cache = steps.find((step) => step.name === "Set up pnpm cache")
  const rust = steps.find((step) => step.name === "Set up Rust")
  const worktree = findStep(steps, "canary-worktree")
  const rustCache = steps.find((step) => step.name === "Cache Rust build artifacts")
  const installDependencies = findStep(steps, "install-dependencies")

  assert.equal(node?.uses, "actions/setup-node@v7", "Node setup must use setup-node@v7")
  assert.equal(node?.with?.["node-version"], 24, "Node setup must select Node 24")
  assert.equal(
    node?.with?.cache,
    undefined,
    "Node setup must not cache pnpm before Corepack is enabled"
  )
  assert.equal(corepack?.run, "corepack enable", "Corepack must be enabled before pnpm caching")
  assert.equal(cache?.uses, "actions/setup-node@v7", "pnpm cache must use setup-node@v7")
  assert.equal(cache?.with?.["node-version"], 24, "pnpm cache setup must select Node 24")
  assert.equal(cache?.with?.cache, "pnpm", "pnpm cache setup must cache pnpm's store")
  assert.ok(
    steps.indexOf(node) < steps.indexOf(corepack) && steps.indexOf(corepack) < steps.indexOf(cache),
    "Node setup, Corepack, and pnpm cache setup must run in that order"
  )
  assert.equal(rust?.uses, "dtolnay/rust-toolchain@stable", "Rust setup must use stable")
  assert.equal(rustCache?.uses, "Swatinem/rust-cache@v2", "Rust build artifacts must be cached")
  assert.equal(
    rustCache?.with?.workspaces,
    `${CANARY_WORKTREE} -> target`,
    "Rust cache must target the isolated canary workspace"
  )
  assert.ok(
    steps.indexOf(rust) < steps.indexOf(worktree) &&
      steps.indexOf(worktree) < steps.indexOf(rustCache) &&
      steps.indexOf(rustCache) < steps.indexOf(installDependencies),
    "Rust setup, canary workspace, Rust cache, and install must run in that order"
  )
}

function assertWorkspaceBinding(steps, id, workingDirectory) {
  assert.equal(
    findStep(steps, id)["working-directory"],
    workingDirectory,
    `${id} must run inside the isolated canary worktree`
  )
}

function assertPhaseCommands(steps) {
  const expectedCommands = new Map([
    ["canary-worktree", /git worktree add --detach/u],
    ["install-dependencies", /^pnpm install --frozen-lockfile$/u],
    ["build-workspace", /^pnpm --filter "@palamedes\/remix\.\.\." -r build$/u],
    [
      "install-remix-next",
      /^pnpm --filter "@palamedes\/example-remix-\*" add remix@next --save-exact$/u,
    ],
    ["remix-next-version", /require\('remix\/package\.json'\)\.version/u],
    ["remix-next-smoke", /^pnpm verify:examples:smoke -- --framework remix$/u],
  ])

  for (const [id, command] of expectedCommands) {
    assert.match(findStep(steps, id).run ?? "", command, `${id} must run its canary command`)
  }
}

export function assertRemixNextCanaryWorkflow(workflow) {
  const triggers = workflow.on
  assert.ok(triggers, "remix@next canary must define triggers")
  assert.equal(triggers.pull_request, undefined, "remix@next canary must not run on pull requests")
  assert.deepEqual(
    triggers.push?.branches,
    ["main"],
    "remix@next canary must run after main changes"
  )
  assert.ok(
    Array.isArray(triggers.schedule) && triggers.schedule.length > 0,
    "canary must detect upstream churn"
  )
  assert.ok("workflow_dispatch" in triggers, "canary must be manually runnable")

  const steps = canarySteps(workflow)
  assertSetupBootstrap(steps)
  assertPhaseCommands(steps)

  for (let index = 1; index < ORDERED_STEP_IDS.length; index += 1) {
    const id = ORDERED_STEP_IDS[index]
    const suffix = id === "remix-next-version" ? "/examples/remix-cookie" : ""
    assertWorkspaceBinding(steps, id, `${CANARY_WORKTREE}${suffix}`)
  }

  for (let index = 1; index < ORDERED_STEP_IDS.length; index += 1) {
    assert.ok(
      stepIndex(steps, ORDERED_STEP_IDS[index - 1]) < stepIndex(steps, ORDERED_STEP_IDS[index]),
      `canary steps must run ${ORDERED_STEP_IDS[index - 1]} before ${ORDERED_STEP_IDS[index]}`
    )
  }

  const cleanup = steps.find((step) => step.name === "Remove isolated canary workspace")
  assert.equal(cleanup?.if, "${{ always() }}", "canary cleanup must always run")
  assert.match(
    cleanup?.run ?? "",
    /git worktree remove --force "\$RUNNER_TEMP\/remix-next-canary"/u,
    "canary cleanup must remove the isolated worktree"
  )
  assert.doesNotMatch(
    JSON.stringify(workflow),
    /continue-on-error/u,
    "canary failures must remain visible"
  )

  assert.deepEqual(
    EXAMPLE_MATRIX.filter((example) => example.framework === "remix").map(
      (example) => example.strategy
    ),
    ["cookie", "route", "subdomain", "tld"],
    "the remix@next smoke verifier must cover every intended Remix strategy"
  )
}

export async function assertCheckedWorkflow() {
  const source = await readFile(
    new URL("../.github/workflows/remix-next-canary.yml", import.meta.url),
    "utf8"
  )
  assertRemixNextCanaryWorkflow(parseWorkflow(source))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await assertCheckedWorkflow()
  console.log("remix@next canary workflow contract is intact")
}
