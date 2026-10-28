// Pure release-set rules that check-release-set.mjs applies to the repository
// files. Each function returns a list of problems; an empty list passes.

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function parseStableVersion(version) {
  const match = stableVersionPattern.exec(version ?? "");
  return match ? match.slice(1, 4).map(Number) : undefined;
}

// `last-release-sha` is a one-time override for the 2.0.0 transition. A stale
// value keeps pointing the changelog at the 1.x history, so it must leave the
// config in the generated release PR that bumps the manifest, which is also
// the commit the Publish workflow validates.
export function releaseOverrideProblems({ releaseConfig, manifestVersion, minimumMajor }) {
  const problems = [];
  const released = parseStableVersion(manifestVersion);
  if (!released) {
    return [
      `release manifest version ${manifestVersion} is not a stable MAJOR.MINOR.PATCH version`,
    ];
  }

  const rootConfig = releaseConfig.packages?.["."] ?? {};
  for (const [scope, config] of [
    ["the top level", releaseConfig],
    ['packages["."]', rootConfig],
  ]) {
    if (config["last-release-sha"] !== undefined && released[0] >= minimumMajor) {
      problems.push(
        `last-release-sha at ${scope} only bridges the unpublished 1.25.1 release; remove it now that the manifest is at ${manifestVersion}`,
      );
    }
  }
  if (rootConfig["last-release-sha"] !== undefined && released[0] < minimumMajor) {
    problems.push(
      'last-release-sha must sit at the top level of .release-please-config.json; release-please ignores it under packages["."]',
    );
  }

  return problems;
}
