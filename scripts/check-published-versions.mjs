// A publish job can fail after some packages have already gone out, which used
// to leave the registry carrying a mixed release set with nothing reporting it.
// This runs after the publish jobs and asserts that every public package really
// resolves at the version in its manifest.
//
// npm's read path is eventually consistent, so a package published seconds ago
// can still 404 on the next request. Retry a missing version a few times before
// treating it as a real gap; anything still missing after that is a failed
// publish, not propagation lag.
import { setTimeout as delay } from "node:timers/promises"

import { publicWorkspacePackages, registryLookup } from "./release-packages.mjs"

const attempts = Number(process.env.PALAMEDES_REGISTRY_ATTEMPTS ?? 5)
const retryDelayMs = Number(process.env.PALAMEDES_REGISTRY_RETRY_MS ?? 15_000)

const packages = publicWorkspacePackages()
const missing = []
const failures = []

for (const packageInfo of packages) {
  const spec = `${packageInfo.name}@${packageInfo.version}`
  let lookup

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lookup = registryLookup(spec)

    if (lookup.state === "found") {
      break
    }

    if (attempt < attempts) {
      console.log(`${spec} not visible yet (attempt ${attempt}/${attempts}); retrying.`)
      await delay(retryDelayMs)
    }
  }

  if (lookup.state === "found") {
    console.log(`${spec} ✓`)
  } else if (lookup.state === "missing") {
    missing.push(spec)
  } else {
    failures.push({ detail: lookup.detail, spec })
  }
}

if (failures.length > 0) {
  console.error("")
  console.error("Could not read the registry for:")
  for (const failure of failures) {
    console.error(`  ${failure.spec}: ${failure.detail}`)
  }
}

if (missing.length > 0) {
  console.error("")
  console.error(`${missing.length} package(s) did not reach the registry:`)
  for (const spec of missing) {
    console.error(`  ${spec}`)
  }
  console.error("")
  console.error(
    "The release is only partially published. Re-run the publish workflow with force_publish once the cause is fixed; already-published packages are skipped."
  )
}

if (missing.length > 0 || failures.length > 0) {
  process.exit(1)
}

console.log("")
console.log(`All ${packages.length} public packages are published at ${packages[0]?.version}.`)
