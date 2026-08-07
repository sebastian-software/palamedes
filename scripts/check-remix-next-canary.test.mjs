import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import {
  CANARY_WORKTREE,
  ORDERED_STEP_IDS,
  assertRemixNextCanaryWorkflow,
  parseWorkflow,
} from "./check-remix-next-canary.mjs"

const require = createRequire(new URL("../packages/config/package.json", import.meta.url))
const { stringify } = require("yaml")
const source = await readFile(
  new URL("../.github/workflows/remix-next-canary.yml", import.meta.url),
  "utf8"
)

function workflowWith(mutate) {
  const workflow = parseWorkflow(source)
  mutate(workflow)
  return workflow
}

function stepsFor(workflow) {
  return workflow.jobs["remix-next-canary"].steps
}

function assertRejected(mutate, message) {
  assert.throws(() => assertRemixNextCanaryWorkflow(workflowWith(mutate)), undefined, message)
}

test("accepts the committed Remix canary workflow", () => {
  assertRemixNextCanaryWorkflow(parseWorkflow(source))
})

test("rejects a pull request trigger", () => {
  assertRejected((workflow) => {
    workflow.on.pull_request = {}
  })
})

test("rejects a pnpm cache before Corepack", () => {
  assertRejected((workflow) => {
    const nodeSetup = stepsFor(workflow).find((step) => step.name === "Set up Node.js")
    nodeSetup.with.cache = "pnpm"
  })
})

test("rejects a missing cache setup after Corepack", () => {
  assertRejected((workflow) => {
    const steps = stepsFor(workflow)
    steps.splice(
      steps.findIndex((step) => step.name === "Set up pnpm cache"),
      1
    )
  })
})

test("rejects cache setup before Corepack", () => {
  assertRejected((workflow) => {
    const steps = stepsFor(workflow)
    const corepackIndex = steps.findIndex((step) => step.name === "Enable Corepack")
    ;[steps[corepackIndex], steps[corepackIndex + 1]] = [
      steps[corepackIndex + 1],
      steps[corepackIndex],
    ]
  })
})

test("rejects every missing or incorrectly bound canary phase", () => {
  for (const id of ORDERED_STEP_IDS) {
    assertRejected((workflow) => {
      const steps = stepsFor(workflow)
      steps.splice(
        steps.findIndex((step) => step.id === id),
        1
      )
    }, `must reject a missing ${id} phase`)
  }

  for (const id of ORDERED_STEP_IDS.slice(1)) {
    assertRejected((workflow) => {
      stepsFor(workflow).find((step) => step.id === id)["working-directory"] = "."
    }, `must reject ${id} outside ${CANARY_WORKTREE}`)
  }
})

test("rejects every adjacent phase reordering", () => {
  for (let index = 1; index < ORDERED_STEP_IDS.length; index += 1) {
    assertRejected(
      (workflow) => {
        const steps = stepsFor(workflow)
        const currentIndex = steps.findIndex((step) => step.id === ORDERED_STEP_IDS[index])
        ;[steps[currentIndex - 1], steps[currentIndex]] = [
          steps[currentIndex],
          steps[currentIndex - 1],
        ]
      },
      `must reject ${ORDERED_STEP_IDS[index]} before ${ORDERED_STEP_IDS[index - 1]}`
    )
  }
})

test("rejects missing or conditional cleanup", () => {
  assertRejected((workflow) => {
    const steps = stepsFor(workflow)
    steps.splice(
      steps.findIndex((step) => step.name === "Remove isolated canary workspace"),
      1
    )
  })

  assertRejected((workflow) => {
    stepsFor(workflow).find((step) => step.name === "Remove isolated canary workspace").if =
      "${{ success() }}"
  })
})

test("rejects a serialized, valid YAML mutation", () => {
  const mutation = workflowWith((workflow) => {
    workflow.on.pull_request = {}
  })
  assert.throws(() => assertRemixNextCanaryWorkflow(parseWorkflow(stringify(mutation))))
})
