// Release-set rules that check-release-set.mjs applies to the repository files.
// Each *Problems function returns a list of problems; an empty list passes.
import { execFileSync } from "node:child_process";

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function parseStableVersion(version) {
  const match = stableVersionPattern.exec(version ?? "");
  return match ? match.slice(1, 4).map(Number) : undefined;
}

function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

// The tag release-please creates for a version of the root package, for
// example palamedes-v2.0.0.
export function releaseTagName(releaseConfig, version) {
  const rootConfig = releaseConfig.packages?.["."] ?? {};
  const component = rootConfig.component ?? releaseConfig.component;
  const includeComponent =
    rootConfig["include-component-in-tag"] ?? releaseConfig["include-component-in-tag"] ?? true;
  const separator = rootConfig["tag-separator"] ?? releaseConfig["tag-separator"] ?? "-";
  const includeV = rootConfig["include-v-in-tag"] ?? releaseConfig["include-v-in-tag"] ?? true;
  const versionPart = `${includeV ? "v" : ""}${version}`;
  return includeComponent && component ? `${component}${separator}${versionPart}` : versionPart;
}

// Where the checked-out commit stands relative to the manifest version's
// release. The generated release PR already carries the new manifest version
// but has no tag yet, and the release commit is the tagged commit itself (or is
// checked before release-please tags it): "unreleased". Only a later commit
// sees the tag on another commit: "released". "unknown": tags were unreadable.
export function releaseTagState({ readable, tagCommit, headCommit }) {
  if (!readable) return "unknown";
  if (!tagCommit || tagCommit === headCommit) return "unreleased";
  return "released";
}

// Reads the release tag from the remote. CI and Publish check out a shallow
// commit without tags, so this asks for the one tag instead of fetching all.
export function lookupReleaseState({ root, remote, tag }) {
  const git = (args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
  try {
    const headCommit = git(["rev-parse", "HEAD"]).trim();
    const refs = new Map(
      git(["ls-remote", "--tags", remote, `refs/tags/${tag}*`])
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("\t").reverse()),
    );
    // An annotated tag also lists its peeled commit as `<ref>^{}`.
    const tagCommit = refs.get(`refs/tags/${tag}^{}`) ?? refs.get(`refs/tags/${tag}`);
    return { state: releaseTagState({ readable: true, tagCommit, headCommit }) };
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    return {
      state: releaseTagState({ readable: false }),
      error: `could not read ${tag} from ${remote}: ${detail}`,
    };
  }
}

export function hasReleaseOverrides(releaseConfig) {
  const rootConfig = releaseConfig.packages?.["."] ?? {};
  return [releaseConfig, rootConfig].some(
    (config) => config["release-as"] !== undefined || config["last-release-sha"] !== undefined,
  );
}

// `release-as` and `last-release-sha` are one-time overrides for the 2.0.0
// transition. They stay through the generated release PR and the release
// commit: release-please rebuilds that PR from main's config and force-pushes
// its branch, so edits there do not last. Once the release exists,
// release-please keeps forcing `release-as`, so the next feat or fix would open
// another "release 2.0.0" PR, and a stale `last-release-sha` keeps pointing the
// changelog at the 1.x history. A follow-up PR on main removes both; until it
// lands, this check fails on every later commit.
export function releaseOverrideProblems({
  releaseConfig,
  manifestVersion,
  minimumMajor,
  releaseState,
}) {
  const problems = [];
  const manifest = parseStableVersion(manifestVersion);
  if (!manifest) {
    return [
      `release manifest version ${manifestVersion} is not a stable MAJOR.MINOR.PATCH version`,
    ];
  }
  const tag = releaseTagName(releaseConfig, manifestVersion);
  const rootConfig = releaseConfig.packages?.["."] ?? {};

  for (const [scope, config] of [
    ["the top level", releaseConfig],
    ['packages["."]', rootConfig],
  ]) {
    const releaseAs = config["release-as"];
    if (releaseAs === undefined) continue;
    const target = parseStableVersion(releaseAs);
    if (!target) {
      problems.push(`release-as at ${scope} must be a stable version, found ${releaseAs}`);
      continue;
    }
    const comparison = compareVersions(target, manifest);
    if (comparison < 0) {
      problems.push(
        `release-as ${releaseAs} at ${scope} is below the manifest version ${manifestVersion}`,
      );
    } else if (comparison === 0 && releaseState === "released") {
      problems.push(
        `release-as ${releaseAs} at ${scope} was released as ${tag}; remove the one-time override so later versions follow conventional commits`,
      );
    }
  }

  if (
    releaseConfig["last-release-sha"] !== undefined &&
    manifest[0] >= minimumMajor &&
    releaseState === "released"
  ) {
    problems.push(
      `last-release-sha only bridged the unpublished 1.25.1 release; remove it now that ${tag} exists`,
    );
  }
  if (rootConfig["last-release-sha"] !== undefined) {
    problems.push(
      'last-release-sha must sit at the top level of .release-please-config.json; release-please ignores it under packages["."]',
    );
  }

  return problems;
}

export const EXACT_PIN_EXTRA_FILE = Object.freeze({ type: "generic", path: "Cargo.toml" });
export const EXACT_PIN_MARKER = "x-release-please-version";

// Code generated by palamedes-build constructs hidden palamedes-i18n items, so
// the two crates must resolve to the same release (the serde/serde_derive
// pattern). release-please's Cargo updater rewrites a member's path-dependency
// `version` to the plain new version, dropping a leading `=`. The pin therefore
// lives in the root `[workspace.dependencies]`, which that updater does not
// touch; a generic extra-file bumps the marked line instead, keeping the `=`.
export function exactPinProblems({ rootCargo, buildCargo, version, extraFiles }) {
  const problems = [];
  const workspaceDependencies =
    /^\[workspace\.dependencies\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/mu.exec(rootCargo)?.[1] ?? "";
  const pin =
    /^palamedes-i18n = \{ version = "=([^"]+)", path = "crates\/palamedes-i18n" \}(.*)$/mu.exec(
      workspaceDependencies,
    );
  if (!pin) {
    problems.push(
      'Cargo.toml [workspace.dependencies] must pin palamedes-i18n = { version = "=<version>", path = "crates/palamedes-i18n" }',
    );
  } else {
    if (pin[1] !== version) {
      problems.push(`the exact palamedes-i18n pin is =${pin[1]}, expected =${version}`);
    }
    if (!pin[2].includes(EXACT_PIN_MARKER)) {
      problems.push(
        `the exact palamedes-i18n pin needs a trailing "# ${EXACT_PIN_MARKER}" comment so the release PR bumps it`,
      );
    }
  }

  const buildDependencies =
    /^\[dependencies\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/mu.exec(buildCargo)?.[1] ?? "";
  if (!/^palamedes-i18n = \{ workspace = true \}\s*$/mu.test(buildDependencies)) {
    problems.push(
      "crates/palamedes-build/Cargo.toml must inherit palamedes-i18n with { workspace = true } so it uses the exact pin",
    );
  }

  const genericEntries = (extraFiles ?? []).filter((file) => file?.type === "generic");
  if (
    genericEntries.length !== 1 ||
    genericEntries[0].path !== EXACT_PIN_EXTRA_FILE.path ||
    genericEntries[0].glob !== undefined
  ) {
    problems.push(
      `root release extra-files must contain exactly one generic entry for ${EXACT_PIN_EXTRA_FILE.path} so the release PR bumps the exact palamedes-i18n pin`,
    );
  }

  return problems;
}
