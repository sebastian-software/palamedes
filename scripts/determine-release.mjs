import { execFileSync } from "node:child_process"
import { appendFileSync } from "node:fs"

const forcePublish = process.env.FORCE_PUBLISH === "true"
const eventName = process.env.GITHUB_EVENT_NAME
const sha = process.env.GITHUB_SHA
let shouldPublish = forcePublish

if (!shouldPublish && eventName === "push") {
  let baseRef = process.env.BASE_REF
  if (baseRef === "0000000000000000000000000000000000000000") {
    baseRef = execFileSync("git", ["rev-parse", "HEAD^"], { encoding: "utf8" }).trim()
  }

  const subjects = execFileSync("git", ["log", "--format=%s", `${baseRef}..${sha}`], {
    encoding: "utf8",
  })
  shouldPublish = /^chore: release /mu.test(subjects)
}

appendFileSync(process.env.GITHUB_OUTPUT, `should_publish=${shouldPublish}\n`)
