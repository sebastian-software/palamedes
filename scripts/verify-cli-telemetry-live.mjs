// Explicit opt-in only: one synthetic invocation, authenticated upload and deletion.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

assert.equal(
  process.env.PALAMEDES_LIVE_TELEMETRY_PROOF,
  "1",
  "Set PALAMEDES_LIVE_TELEMETRY_PROOF=1 only for the owned synthetic service lifecycle.",
);
assert.ok(
  process.argv[2] && process.argv[3],
  "Usage: node scripts/verify-cli-telemetry-live.mjs <binary-or-launcher> <UI-catalog-directory>",
);
const binary = resolve(process.argv[2]);
const catalogs = resolve(process.argv[3]);
const launcher = /\.(?:c|m)?js$/u.test(binary) ? process.execPath : binary;
const prefix = launcher === binary ? [] : [binary];
const fixture = mkdtempSync(join(tmpdir(), "palamedes-owned-telemetry-proof-"));
const project = join(fixture, "project");
const profile = join(fixture, "consented");
mkdirSync(project);
mkdirSync(profile);
mkdirSync(join(project, "locales"));
writeFileSync(
  join(project, "palamedes.yaml"),
  "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [app]\n",
);
writeFileSync(join(project, "locales/en.po"), 'msgid "Hello"\nmsgstr "Hello"\n');
const environment = {
  HOME: profile,
  XDG_STATE_HOME: profile,
  LOCALAPPDATA: profile,
  APP_TRACKING_STATE_DIR: join(profile, "state"),
  PALAMEDES_UI_CATALOG_DIR: catalogs,
  PALAMEDES_UI_LOCALE: "en",
  PALAMEDES_UPDATE_CHECK: "0",
};
for (const name of ["PATH", "SystemRoot", "TMPDIR"])
  if (process.env[name]) environment[name] = process.env[name];
function run(args, overrides = {}) {
  const result = spawnSync(launcher, [...prefix, ...args], {
    cwd: project,
    env: { ...environment, ...overrides },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result;
}
function status() {
  return JSON.parse(run(["telemetry", "status"]).stdout);
}
async function waitFor(predicate, label, { flush = false } = {}) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const result = spawnSync(launcher, [...prefix, "telemetry", "status"], {
      cwd: project,
      env: environment,
      encoding: "utf8",
      timeout: 10_000,
    });
    if (!result.error && result.status === 0) {
      const current = JSON.parse(result.stdout);
      assert.equal(current.terminal_status, null, "synthetic client entered a terminal error");
      if (predicate(current)) return current;
      // Registration and report delivery are separate attempts. Respect the
      // shared client's minimum interval instead of bypassing its retry state.
      if (flush && Date.now() >= current.next_attempt_ms) run(["telemetry", "flush"]);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
let cleanupVerified = false;
try {
  run(["telemetry", "enable"]);
  assert.equal(status().installation_id, null, "notice-only created a remote identity");
  const baseline = run(["report", "--json"]);
  assert.equal(status().unsent_invocations, 0, "unconsented command counted");
  run(["telemetry", "enable", "--accept", "telemetry-v1"]);
  const reported = run(["report", "--json"]);
  assert.equal(reported.stdout, baseline.stdout);
  assert.equal(reported.stderr, baseline.stderr);
  const registered = await waitFor(
    (s) => s.installation_id !== null,
    "local installation authority",
  );
  assert.equal(registered.unsent_invocations, 1);
  const preview = JSON.parse(run(["telemetry", "preview"]).stdout);
  assert.equal(preview.open_rows.length, 1);
  assert.equal(preview.open_rows[0].command, "report");
  assert.equal(preview.open_rows[0].count, 1);
  run(["telemetry", "flush"]);
  const uploaded = await waitFor((s) => s.unsent_invocations === 0, "report acknowledgement", {
    flush: true,
  });
  assert.equal(uploaded.dropped_invocations, 0);
  run(["telemetry", "disable"]);
  run(["report", "--json"]);
  assert.equal(status().unsent_invocations, 0, "withdrawn command counted");
  console.log(
    JSON.stringify({
      noticeOnlyDidNotConsent: true,
      nativeInvocationCount: 1,
      uploadAcknowledged: true,
      withdrawalRespected: true,
      stdoutJsonAndExitPreserved: true,
    }),
  );
} finally {
  try {
    run(["telemetry", "delete"]);
    const deleted = await waitFor(
      (s) => ["confirmed", "no_active_record", "no_remote_identity"].includes(s.deletion),
      "deletion acknowledgement",
      { flush: true },
    );
    assert.equal(deleted.unsent_invocations, 0);
    cleanupVerified = true;
    console.log(
      JSON.stringify({ syntheticDeletionAcknowledged: true, deletion: deleted.deletion }),
    );
  } finally {
    if (cleanupVerified) rmSync(fixture, { recursive: true, force: true });
    else console.error(`Synthetic cleanup is not confirmed; private state retained at ${fixture}.`);
  }
}
