// Offline installed-consumer proof: consent, CI isolation and watch accounting.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.ok(
  process.argv[2] && process.argv[3],
  "Usage: node scripts/verify-cli-telemetry-policy.mjs <binary-or-launcher> <UI-catalog-directory>",
);
const binary = resolve(process.argv[2]);
const catalogs = resolve(process.argv[3]);
const fixture = realpathSync(mkdtempSync(join(tmpdir(), "palamedes-offline-telemetry-proof-")));
const project = join(fixture, "project");
mkdirSync(project, { mode: 0o700 });
mkdirSync(join(project, "app"));
mkdirSync(join(project, "locales"));
writeFileSync(
  join(project, "palamedes.yaml"),
  "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [app]\n",
);
const source = join(project, "app/main.ts");
const sourceText = (message) =>
  `import {t} from '@palamedes/core/macro'; export function title() { return t\`${message}\`; }\n`;
writeFileSync(source, sourceText("Watch First"));
const launch = /\.(?:c|m)?js$/u.test(binary) ? process.execPath : binary;
const prefix = launch === binary ? [] : [binary];
function profile(name) {
  const home = join(fixture, name);
  mkdirSync(home, { mode: 0o700 });
  const env = {
    HOME: home,
    USERPROFILE: home,
    LOCALAPPDATA: home,
    XDG_CACHE_HOME: home,
    XDG_STATE_HOME: home,
    XDG_CONFIG_HOME: home,
    XDG_DATA_HOME: home,
    APP_TRACKING_STATE_DIR: join(home, "state"),
    PALAMEDES_UI_CATALOG_DIR: catalogs,
    PALAMEDES_UI_LOCALE: "en",
    PALAMEDES_UPDATE_CHECK: "0",
    PALAMEDES_OFFLINE: "1",
  };
  for (const name of ["PATH", "SystemRoot", "TMPDIR"])
    if (process.env[name]) env[name] = process.env[name];
  return env;
}
function run(env, args, settings = {}) {
  const result = spawnSync(launch, [...prefix, ...args], {
    cwd: project,
    env: { ...env, ...settings },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  return result;
}
function ok(env, args, settings) {
  const result = run(env, args, settings);
  assert.equal(result.status, 0, result.stderr);
  return result;
}
const status = (env, settings) => JSON.parse(ok(env, ["telemetry", "status"], settings).stdout);
const enable = (env) => ok(env, ["telemetry", "enable", "--accept", "telemetry-v1"]);
try {
  const local = profile("local");
  ok(local, ["telemetry", "enable"]);
  const failing = ["report", "--config", join(project, "absent.yaml"), "--json"];
  const baseline = run(local, failing);
  assert.equal(baseline.status, 1);
  assert.equal(status(local).unsent_invocations, 0);
  enable(local);
  const consented = run(local, failing);
  assert.equal(consented.status, baseline.status);
  assert.equal(consented.stdout, baseline.stdout);
  assert.equal(consented.stderr, baseline.stderr);
  assert.equal(status(local).unsent_invocations, 1);
  for (const args of [["version"], ["--help"], ["telemetry", "preview"], ["telemetry", "status"]])
    ok(local, args);
  assert.equal(run(local, ["report", "--not-a-real-option"]).status, 2);
  assert.equal(status(local).unsent_invocations, 1, "control or parse failure counted");
  run(local, ["report", "--json"], { DO_NOT_TRACK: "1" });
  assert.equal(status(local).unsent_invocations, 0);
  ok(local, ["telemetry", "disable"]);
  run(local, failing, { APP_TRACKING_CONSENT: "telemetry-v1" });
  assert.equal(status(local).unsent_invocations, 0, "environment grant overrode withdrawal");

  const ci = profile("ci");
  enable(ci);
  const ciGrant = {
    CI: "1",
    APP_TRACKING_CONSENT: "telemetry-v1",
    APP_TRACKING_CI: "telemetry-v1",
  };
  run(ci, failing, { CI: "1", APP_TRACKING_CONSENT: "telemetry-v1" });
  assert.equal(status(ci, { CI: "1" }).unsent_invocations, 0);
  run(ci, failing, ciGrant);
  assert.equal(status(ci, ciGrant).unsent_invocations, 1);
  assert.equal(status(ci).unsent_invocations, 0, "CI count leaked into local scope");

  const watch = profile("watch");
  enable(watch);
  const child = spawn(launch, [...prefix, "extract", "--watch"], {
    cwd: project,
    env: watch,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = once(child, "close");
  let output = "";
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", () => {});
  async function extracted(message) {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && child.exitCode === null) {
      let catalog = "";
      try {
        catalog = readFileSync(join(project, "locales/en.po"), "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      if (catalog.includes(message) && output.includes("Watching for changes...")) return;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Watch did not extract the synthetic ${message} fixture`);
  }
  try {
    await extracted("Watch First");
    assert.equal(status(watch).unsent_invocations, 1);
    writeFileSync(source, sourceText("Watch Second"));
    await extracted("Watch Second");
  } finally {
    child.kill(process.platform === "win32" ? undefined : "SIGINT");
    await closed;
  }
  assert.equal(status(watch).unsent_invocations, 1, "watch rebuild or interruption counted twice");
  console.log(
    JSON.stringify({
      noticeOnlyDidNotConsent: true,
      failedInvocationCountedOnce: true,
      controlsAndParseFailureExcluded: true,
      withdrawalAndOptOutRespected: true,
      separateCiConsentRequired: true,
      localAndCiStateIsolated: true,
      watchRebuildAndSignalCountedOnce: true,
      stdoutJsonAndExitPreserved: true,
      offlineOnly: true,
    }),
  );
} finally {
  // Every command was hard-offline; these profiles have no remote authority.
  rmSync(fixture, { recursive: true, force: true });
}
