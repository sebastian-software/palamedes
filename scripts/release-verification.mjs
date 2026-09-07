import { setTimeout as delay } from "node:timers/promises";

export const NATIVE_TARBALL_MIN_UNPACKED_SIZE = 1_000_000;

export function nativeTarballFailure(packageInfo, unpackedSize) {
  if (!packageInfo.nativeArtifact) {
    return null;
  }

  const size = Number(unpackedSize);
  if (Number.isFinite(size) && size >= NATIVE_TARBALL_MIN_UNPACKED_SIZE) {
    return null;
  }

  return `${packageInfo.name}@${packageInfo.version} has native artifact ${packageInfo.nativeArtifact}, but its npm tarball is only ${String(unpackedSize)} bytes unpacked (expected at least ${NATIVE_TARBALL_MIN_UNPACKED_SIZE}).`;
}

// npm can acknowledge a publish before every read replica serves its version.
// Check each package once first, then spend the bounded propagation budget only
// on the packages that were genuinely absent. Transport and metadata errors are
// failures, not evidence of propagation lag.
export async function verifyPublishedVersions({
  packages,
  registryLookup,
  retryBudgetMs,
  retryDelayMs,
  wait = delay,
  now = Date.now,
  log = console.log,
}) {
  const failures = [];
  let missing = [];

  const record = (packageInfo) => {
    const result = verifyPublishedPackage(packageInfo, registryLookup);
    const spec = `${packageInfo.name}@${packageInfo.version}`;

    if (result.state === "found") {
      log(`${spec} ✓`);
    } else if (result.state === "missing") {
      missing.push(packageInfo);
    } else {
      failures.push({ detail: result.detail, spec });
    }
  };

  for (const packageInfo of packages) {
    record(packageInfo);
  }

  const deadline = now() + retryBudgetMs;
  while (missing.length > 0 && now() < deadline) {
    const waitMs = Math.min(retryDelayMs, deadline - now());
    log(`${missing.length} package(s) not visible yet; rechecking after ${waitMs}ms.`);
    await wait(waitMs);

    const unresolved = missing;
    missing = [];
    for (const packageInfo of unresolved) {
      record(packageInfo);
    }
  }

  return {
    failures,
    missing: missing.map((packageInfo) => `${packageInfo.name}@${packageInfo.version}`),
  };
}

function verifyPublishedPackage(packageInfo, registryLookup) {
  const spec = `${packageInfo.name}@${packageInfo.version}`;
  const versionLookup = registryLookup(spec);

  if (versionLookup.state !== "found") {
    return versionLookup;
  }

  if (!packageInfo.nativeArtifact) {
    return versionLookup;
  }

  const tarballLookup = registryLookup(spec, "dist.unpackedSize");
  if (tarballLookup.state !== "found") {
    return tarballLookup;
  }

  const tarballFailure = nativeTarballFailure(packageInfo, tarballLookup.value);
  return tarballFailure ? { detail: tarballFailure, state: "error" } : tarballLookup;
}
