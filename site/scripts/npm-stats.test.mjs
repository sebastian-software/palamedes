import assert from "node:assert/strict"
import test from "node:test"

import { fetchNpmPackageStats } from "./npm-stats.mjs"

const registryUrl = "https://registry.npmjs.org/%40palamedes%2Fvite-plugin/latest"
const downloadsUrl = "https://api.npmjs.org/downloads/point/last-month/%40palamedes%2Fvite-plugin"

function response(value, { ok = true, status = 200, statusText = "OK" } = {}) {
  return {
    ok,
    status,
    statusText,
    json: async () => value,
  }
}

function npmFetch({ registry, downloads }) {
  return async (url) => {
    if (url === registryUrl) return registry
    if (url === downloadsUrl) return downloads
    throw new Error(`Unexpected URL: ${url}`)
  }
}

test("uses only npm-confirmed values for a complete snapshot", async () => {
  const stats = await fetchNpmPackageStats("@palamedes/vite-plugin", {
    fetchImpl: npmFetch({
      registry: response({ version: "1.17.3" }),
      downloads: response({ downloads: 2701, start: "2026-07-17", end: "2026-08-15" }),
    }),
  })

  assert.deepEqual(stats, {
    name: "@palamedes/vite-plugin",
    version: "1.17.3",
    monthlyDownloads: 2701,
    period: "2026-07-17/2026-08-15",
    source: "npm",
  })
})

test("does not substitute a workspace version when the npm registry fails", async () => {
  const warnings = []
  const stats = await fetchNpmPackageStats("@palamedes/vite-plugin", {
    fetchImpl: npmFetch({
      registry: response({}, { ok: false, status: 503, statusText: "Unavailable" }),
      downloads: response({ downloads: 2701, start: "2026-07-17", end: "2026-08-15" }),
    }),
    warn: (warning) => warnings.push(warning),
  })

  assert.equal(stats.version, null)
  assert.equal(stats.monthlyDownloads, 2701)
  assert.equal(stats.source, "npm-partial")
  assert.equal(warnings.length, 1)
})

test("retains a confirmed registry version when only downloads fail", async () => {
  const stats = await fetchNpmPackageStats("@palamedes/vite-plugin", {
    fetchImpl: npmFetch({
      registry: response({ version: "1.17.3" }),
      downloads: response({}, { ok: false, status: 503, statusText: "Unavailable" }),
    }),
    warn() {},
  })

  assert.equal(stats.version, "1.17.3")
  assert.equal(stats.monthlyDownloads, null)
  assert.equal(stats.source, "npm-partial")
})

test("marks the snapshot unavailable when neither npm endpoint responds", async () => {
  const unavailable = response({}, { ok: false, status: 503, statusText: "Unavailable" })
  const stats = await fetchNpmPackageStats("@palamedes/vite-plugin", {
    fetchImpl: npmFetch({ registry: unavailable, downloads: unavailable }),
    warn() {},
  })

  assert.equal(stats.version, null)
  assert.equal(stats.monthlyDownloads, null)
  assert.equal(stats.source, "unavailable")
})
