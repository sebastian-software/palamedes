import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function readReleasePolicy(root = process.cwd()) {
  const policy = JSON.parse(readFileSync(path.join(root, ".release-policy.json"), "utf8"));
  if (
    !Number.isSafeInteger(policy?.minimumMajor) ||
    policy.minimumMajor < 1 ||
    typeof policy.publicationEnabled !== "boolean" ||
    typeof policy.reason !== "string" ||
    !policy.reason.trim()
  ) {
    throw new Error(
      "Invalid .release-policy.json: expected minimumMajor, publicationEnabled, and reason.",
    );
  }
  return policy;
}

export function publicationAllowed(policy, version) {
  if (!policy.publicationEnabled) return false;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match || Number(match[1]) < policy.minimumMajor) {
    throw new Error(
      `Publication requires a stable version with major >= ${policy.minimumMajor}; found ${version}.`,
    );
  }
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const policy = readReleasePolicy();
  appendFileSync(process.env.GITHUB_OUTPUT, `publication_enabled=${policy.publicationEnabled}\n`);
  if (!policy.publicationEnabled) console.log(`Release hold: ${policy.reason}`);
}
