import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";

import { publicationAllowed, readReleasePolicy } from "./release-policy.mjs";

const forcePublish = process.env.FORCE_PUBLISH === "true";
const eventName = process.env.GITHUB_EVENT_NAME;
const sha = process.env.GITHUB_SHA;
const policy = readReleasePolicy();
const dryRun = eventName === "workflow_dispatch" && process.env.DRY_RUN === "true";
let shouldPublish = forcePublish;

if (!shouldPublish && eventName === "push") {
  let baseRef = process.env.BASE_REF;
  if (baseRef === "0000000000000000000000000000000000000000") {
    baseRef = execFileSync("git", ["rev-parse", "HEAD^"], { encoding: "utf8" }).trim();
  }

  const subjects = execFileSync("git", ["log", "--format=%s", `${baseRef}..${sha}`], {
    encoding: "utf8",
  });
  shouldPublish = /^chore: release /mu.test(subjects);
}

if (shouldPublish && !dryRun) {
  const version = JSON.parse(readFileSync(".release-please-manifest.json", "utf8"))["."];
  shouldPublish = publicationAllowed(policy, version);
  if (!shouldPublish) console.log(`Release hold: ${policy.reason}`);
}

appendFileSync(process.env.GITHUB_OUTPUT, `should_publish=${shouldPublish}\n`);
