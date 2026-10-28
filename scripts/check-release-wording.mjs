import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Once the release version reaches this stable version, pre-release status
// wording must be gone from the public surface. Before it, the check is a no-op.
export const RELEASE_WORDING_GATE = "2.0.0";

// Phrases that describe v2 as held, draft, unreleased, or as a 1.x-only registry
// state. They were copied from the files below as they read today, so each one
// matches current text. Matching is case-insensitive and line by line: a phrase
// must sit on one line of its file.
export const PRERELEASE_WORDING_PHRASES = Object.freeze([
  "Draft for the planned 2.0",
  "Publication remains held",
  "publication is on hold",
  "not published yet",
  "unreleased Palamedes v2",
  "release hold",
  "coordinated release is held",
  "not released",
  "2.0 preview",
  "Registry latest still supplies 1.x",
  "npm currently ships 1.x",
  "1.x contract",
]);

// Public documentation, site, and agent-facing surfaces that describe the v2
// release status. Paths are relative to the repository root.
export const RELEASE_WORDING_FILES = Object.freeze([
  "docs/release-notes-v2.md",
  "docs/migration-v2.md",
  "README.md.src",
  "site/app/components/V2ReleaseNotice.tsx",
  "site/app/components/home/HomeFaq.tsx",
  "docs/stability.md",
  "docs/api/waku.md",
  "packages/waku/README.md",
  "site/app/routes/frameworks/waku.tsx",
  "llms.txt",
  "llms-full.txt",
  "docs/rust-applications.md",
  "skills/palamedes/SKILL.md",
  "docs/agent-skill.md",
]);

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/u;

function parseVersion(version) {
  const match = versionPattern.exec(version ?? "");
  if (!match) {
    throw new Error(`Unsupported release version "${version}"; expected MAJOR.MINOR.PATCH.`);
  }
  return { core: match.slice(1, 4).map(Number), prerelease: match[4] !== undefined };
}

// A prerelease of the gate version (for example 2.0.0-rc.1) sorts below it, as
// in SemVer, so it does not activate the check.
export function reachesReleaseGate(version) {
  const { core, prerelease } = parseVersion(version);
  const gate = parseVersion(RELEASE_WORDING_GATE).core;
  for (let index = 0; index < core.length; index += 1) {
    if (core[index] !== gate[index]) return core[index] > gate[index];
  }
  return !prerelease;
}

// Pure check. `files` maps a repository-relative path to its text. Returns
// { status: "skipped" | "ok" | "failed", version, hits } where each hit is
// { file, line, phrase } with a 1-based line number.
export function findPrereleaseWording({ version, files, phrases = PRERELEASE_WORDING_PHRASES }) {
  if (!reachesReleaseGate(version)) {
    return { status: "skipped", version, hits: [] };
  }

  const hits = [];
  for (const [file, text] of Object.entries(files)) {
    text.split(/\r?\n/u).forEach((line, index) => {
      const lowerLine = line.toLowerCase();
      for (const phrase of phrases) {
        if (lowerLine.includes(phrase.toLowerCase())) {
          hits.push({ file, line: index + 1, phrase });
        }
      }
    });
  }

  return { status: hits.length > 0 ? "failed" : "ok", version, hits };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const root = process.cwd();
  const version = JSON.parse(
    readFileSync(path.join(root, ".release-please-manifest.json"), "utf8"),
  )["."];

  if (!reachesReleaseGate(version)) {
    console.log(`skipped: version ${version} < ${RELEASE_WORDING_GATE}`);
  } else {
    const files = Object.fromEntries(
      RELEASE_WORDING_FILES.map((file) => [file, readFileSync(path.join(root, file), "utf8")]),
    );
    const result = findPrereleaseWording({ version, files });

    if (result.status === "failed") {
      console.error(`Pre-release wording remains at version ${version}:`);
      for (const hit of result.hits) {
        console.error(`${hit.file}:${hit.line}: ${hit.phrase}`);
      }
      process.exitCode = 1;
    } else {
      console.log(
        `Release wording is clean for version ${version} across ${RELEASE_WORDING_FILES.length} files.`,
      );
    }
  }
}
