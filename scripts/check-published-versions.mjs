// A publish job can fail after some packages have already gone out, which used
// to leave the registry carrying a mixed release set with nothing reporting it.
// This runs after the publish jobs and asserts that every public package really
// resolves at the version in its manifest.
//
// npm's read path is eventually consistent, so a successful publish can still
// 404 for several minutes. Retry every unresolved package against one shared
// deadline before treating it as a real gap; resolved packages leave the set
// immediately instead of making every retry round repeat the full release.
import { publicWorkspacePackages, registryLookup } from "./release-packages.mjs"
import {
  nativeTarballFailure,
  REGISTRY_VERIFICATION_RETRY_MS,
  REGISTRY_VERIFICATION_TIMEOUT_MS,
  waitForRegistryEntries,
} from "./release-verification.mjs"

const timeoutMs = durationFromEnvironment(
  "PALAMEDES_REGISTRY_TIMEOUT_MS",
  REGISTRY_VERIFICATION_TIMEOUT_MS
)
const retryDelayMs = durationFromEnvironment(
  "PALAMEDES_REGISTRY_RETRY_MS",
  REGISTRY_VERIFICATION_RETRY_MS
)

const packages = publicWorkspacePackages()
const missing = []
const failures = []
const packageEntries = packages.map((packageInfo) => ({
  packageInfo,
  spec: `${packageInfo.name}@${packageInfo.version}`,
}))
const published = await waitForRegistryEntries(packageEntries, {
  lookup: ({ spec }) => registryLookup(spec),
  onRetry: reportRetry,
  retryDelayMs,
  timeoutMs,
})

for (const entry of published.unresolved) {
  if (entry.lookup.state === "missing") {
    missing.push(entry.spec)
  } else {
    failures.push({ detail: entry.lookup.detail, spec: entry.spec })
  }
}

const nativeEntries = published.found.filter(({ packageInfo }) => packageInfo.nativeArtifact)
const nativeTarballs = await waitForRegistryEntries(nativeEntries, {
  lookup: ({ spec }) => registryLookup(spec, "dist.unpackedSize"),
  onRetry: (entries, retry) => reportRetry(entries, retry, " tarball metadata"),
  retryDelayMs,
  timeoutMs,
})

for (const { lookup, packageInfo, spec } of nativeTarballs.found) {
  const tarballFailure = nativeTarballFailure(packageInfo, lookup.value)
  if (tarballFailure) {
    failures.push({ detail: tarballFailure, spec })
  }
}

for (const { lookup, spec } of nativeTarballs.unresolved) {
  failures.push({
    detail: `${spec}: could not read native tarball metadata: ${lookup.detail ?? "unknown registry error"}`,
    spec,
  })
}

const failedSpecs = new Set([...missing, ...failures.map(({ spec }) => spec)])
for (const { spec } of published.found) {
  if (!failedSpecs.has(spec)) {
    console.log(`${spec} ✓`)
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

function durationFromEnvironment(name, fallback) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive number of milliseconds.`)
  }
  return value
}

function reportRetry(entries, { attempt, delayMs, remainingMs }, subject = "") {
  const delaySeconds = Math.ceil(delayMs / 1000)
  const remainingSeconds = Math.ceil(remainingMs / 1000)
  for (const { spec } of entries) {
    console.log(
      `${spec}${subject} not visible yet after attempt ${attempt}; retrying in ${delaySeconds}s (${remainingSeconds}s before deadline).`
    )
  }
}
