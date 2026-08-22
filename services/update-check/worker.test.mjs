import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import worker from "./worker.mjs"

test("deployment config keeps the route, aggregate binding, and request logs explicit", () => {
  const source = readFileSync(new URL("wrangler.jsonc", import.meta.url), "utf8")
  const config = JSON.parse(source.replace(/,\s*([}\]])/g, "$1"))
  assert.deepEqual(config.observability, { enabled: false })
  assert.deepEqual(config.routes, [
    { pattern: "version.palamedes.dev/check", zone_name: "palamedes.dev" },
  ])
  assert.deepEqual(config.analytics_engine_datasets, [
    { binding: "UPDATE_CHECKS", dataset: "palamedes_update_checks" },
  ])
  assert.equal(Object.hasOwn(config, "vars"), false, "LATEST_VERSION must be supplied at deploy")
})

function environment(...versions) {
  const latestVersion = versions.length === 0 ? "1.4.0" : versions[0]
  const points = []
  return {
    value: {
      LATEST_VERSION: latestVersion,
      UPDATE_CHECKS: {
        writeDataPoint(point) {
          points.push(point)
        },
      },
    },
    points,
  }
}

function request(body, init = {}) {
  return new Request("https://version.palamedes.dev/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    ...init,
  })
}

test("uses protocol metadata only for validation and stores approved dimensions", async () => {
  const env = environment()
  const response = await worker.fetch(
    request(
      { version: "1.2.3", os: "linux", arch: "x86_64", ci: false },
      {
        headers: {
          "Content-Type": "application/json",
          "Content-Length": "65",
          "User-Agent": "identifying-agent",
          "CF-Connecting-IP": "192.0.2.1",
          "X-Forwarded-For": "192.0.2.1",
        },
      }
    ),
    env.value
  )

  assert.equal(response.status, 200)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.deepEqual(await response.json(), { latestVersion: "1.4.0" })
  assert.deepEqual(env.points, [{ blobs: ["1.2.3", "linux", "x86_64", "local"], doubles: [1] }])
  assert.equal(JSON.stringify(env.points).includes("ip"), false)
  assert.equal(JSON.stringify(env.points).includes("identifying-agent"), false)
  assert.equal(JSON.stringify(env.points).includes("content"), false)
})

test("rejects extra identifying fields without writing analytics", async () => {
  for (const extra of [
    { installationId: "abc" },
    { cwd: "/Users/alex/project" },
    { command: "extract" },
    { userAgent: "pmds" },
  ]) {
    const env = environment()
    const response = await worker.fetch(
      request({ version: "1.2.3", os: "linux", arch: "x86_64", ci: false, ...extra }),
      env.value
    )
    assert.equal(response.status, 400)
    assert.deepEqual(env.points, [])
  }
})

test("validates semver, dimensions, boolean CI, method, path, and body limit", async () => {
  const invalidPayloads = [
    { version: "01.2.3", os: "linux", arch: "x86_64", ci: false },
    { version: "1.2.3-01", os: "linux", arch: "x86_64", ci: false },
    { version: "1.2.3", os: "Linux user@example.com", arch: "x86_64", ci: false },
    { version: "1.2.3", os: "linux", arch: "../secret", ci: false },
    { version: "1.2.3", os: "linux", arch: "x86_64", ci: "false" },
  ]
  for (const payload of invalidPayloads) {
    const response = await worker.fetch(request(payload), environment().value)
    assert.equal(response.status, 400)
  }

  const method = await worker.fetch(
    new Request("https://version.palamedes.dev/check"),
    environment().value
  )
  assert.equal(method.status, 405)
  assert.equal(method.headers.get("allow"), "POST")

  const path = await worker.fetch(
    new Request("https://version.palamedes.dev/other"),
    environment().value
  )
  assert.equal(path.status, 404)

  const oversized = await worker.fetch(
    request({ version: "1.2.3", os: "x".repeat(2000), arch: "x86_64", ci: false }),
    environment().value
  )
  assert.equal(oversized.status, 400)

  const wrongMediaType = await worker.fetch(
    request(
      { version: "1.2.3", os: "linux", arch: "x86_64", ci: false },
      { headers: { "Content-Type": "text/plain" } }
    ),
    environment().value
  )
  assert.equal(wrongMediaType.status, 415)
})

test("fails closed when deployment has no valid latest version", async () => {
  for (const latestVersion of [undefined, "", "latest", "01.2.3"]) {
    const env = environment(latestVersion)
    const response = await worker.fetch(
      request({ version: "1.2.3", os: "linux", arch: "x86_64", ci: true }),
      env.value
    )
    assert.equal(response.status, 503)
    assert.deepEqual(env.points, [])
  }

  const missingAnalytics = environment()
  delete missingAnalytics.value.UPDATE_CHECKS
  const response = await worker.fetch(
    request({ version: "1.2.3", os: "linux", arch: "x86_64", ci: true }),
    missingAnalytics.value
  )
  assert.equal(response.status, 503)
})
