// A publish job can fail after some packages have already gone out, which used
// to leave the registry carrying a mixed release set with nothing reporting it.
// This runs after the publish jobs and asserts that every public package really
// resolves at the version in its manifest.
//
import { publicWorkspacePackages, registryLookup } from "./release-packages.mjs";
import { verifyPublishedVersions } from "./release-verification.mjs";

const retryBudgetMs = durationFromEnvironment("PALAMEDES_REGISTRY_RETRY_BUDGET_MS", 5 * 60_000);
const retryDelayMs = durationFromEnvironment("PALAMEDES_REGISTRY_RETRY_MS", 15_000, {
  allowZero: false,
});

const packages = publicWorkspacePackages();
const { failures, missing } = await verifyPublishedVersions({
  packages,
  registryLookup,
  retryBudgetMs,
  retryDelayMs,
});

if (failures.length > 0) {
  console.error("");
  console.error("Could not read the registry for:");
  for (const failure of failures) {
    console.error(`  ${failure.spec}: ${failure.detail}`);
  }
}

if (missing.length > 0) {
  console.error("");
  console.error(`${missing.length} package(s) did not reach the registry:`);
  for (const spec of missing) {
    console.error(`  ${spec}`);
  }
  console.error("");
  console.error(
    "The release is only partially published. Re-run the publish workflow with force_publish once the cause is fixed; already-published packages are skipped.",
  );
}

if (missing.length > 0 || failures.length > 0) {
  process.exit(1);
}

console.log("");
console.log(`All ${packages.length} public packages are published at ${packages[0]?.version}.`);

function durationFromEnvironment(name, fallback, { allowZero = true } = {}) {
  const duration = Number(process.env[name]);
  if (!Number.isFinite(duration) || duration < 0 || (!allowZero && duration === 0)) {
    return fallback;
  }
  return duration;
}
