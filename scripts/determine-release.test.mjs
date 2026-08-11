import { execFileSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import test from "node:test"

const script = path.resolve(import.meta.dirname, "determine-release.mjs")

function fixtureRepository(subjects) {
  const root = mkdtempSync(path.join(os.tmpdir(), "palamedes-determine-release-"))
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: root })
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root })
  execFileSync("git", ["config", "user.name", "Test"], { cwd: root })
  for (const [index, subject] of subjects.entries()) {
    writeFileSync(path.join(root, `change-${index}`), subject)
    execFileSync("git", ["add", "."], { cwd: root })
    execFileSync("git", ["-c", "commit.gpgSign=false", "commit", "-m", subject], { cwd: root })
  }
  return root
}

function determine(root, env) {
  const output = path.join(root, "output")
  writeFileSync(output, "")
  execFileSync("node", [script], {
    cwd: root,
    env: { ...process.env, GITHUB_OUTPUT: output, ...env },
  })
  return readFileSync(output, "utf8")
}

test("determines release publication from force-publish and release commits", () => {
  const root = fixtureRepository(["feat: first", "chore: release 1.17.0"])
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
  const base = execFileSync("git", ["rev-parse", "HEAD^"], { cwd: root, encoding: "utf8" }).trim()

  try {
    assert.equal(
      determine(root, { BASE_REF: base, GITHUB_EVENT_NAME: "push", GITHUB_SHA: sha }),
      "should_publish=true\n"
    )
    assert.equal(
      determine(root, { FORCE_PUBLISH: "true", GITHUB_EVENT_NAME: "workflow_dispatch" }),
      "should_publish=true\n"
    )
    assert.equal(
      determine(root, { BASE_REF: base, GITHUB_EVENT_NAME: "push", GITHUB_SHA: base }),
      "should_publish=false\n"
    )
  } finally {
    rmSync(root, { force: true, recursive: true })
  }
})
