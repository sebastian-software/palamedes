// Explicit opt-in only: synthetic invocations, authenticated upload and deletion.
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
  "Usage: node scripts/verify-cli-telemetry-live.mjs <binary-or-launcher> <UI-catalog-directory> [--additional-permissions | --unified-only]",
);
const unifiedOnly = process.argv.includes("--unified-only");
const additional = unifiedOnly || process.argv.includes("--additional-permissions");
const binary = resolve(process.argv[2]);
const catalogs = resolve(process.argv[3]);
const launcher = /\.(?:c|m)?js$/u.test(binary) ? process.execPath : binary;
const prefix = launcher === binary ? [] : [binary];
const fixture = mkdtempSync(join(tmpdir(), "palamedes-owned-telemetry-proof-"));
const project = join(fixture, "project");
const profile = join(fixture, "consented");
mkdirSync(project, { mode: 0o700 });
mkdirSync(profile, { mode: 0o700 });
mkdirSync(join(project, "locales"));
writeFileSync(
  join(project, "palamedes.yaml"),
  "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [app]\n",
);
writeFileSync(join(project, "locales/en.po"), 'msgid "Hello"\nmsgstr "Hello"\n');
const environment = {
  HOME: profile,
  USERPROFILE: profile,
  XDG_CACHE_HOME: profile,
  XDG_CONFIG_HOME: profile,
  XDG_DATA_HOME: profile,
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
    timeout: 30_000,
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
async function unifiedChoice(purpose, action, decision, revision) {
  const args = ["telemetry", purpose, action];
  if (revision) args.push("--accept", revision);
  run(args);
  for (let attempt = 0; attempt <= 3; attempt++) {
    const value = status().unified[purpose];
    if (value.decision === decision && !value.pending) return;
    if (attempt === 3) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    run(["telemetry", purpose, "sync"]);
  }
  throw new Error(`${purpose} choice did not receive an exact acknowledgement`);
}
async function waitForUnified(predicate, label) {
  const deadline = Date.now() + 90_000;
  let nextSync = 0;
  while (Date.now() < deadline) {
    if (predicate(status().unified)) return;
    if (Date.now() >= nextSync) {
      run(["telemetry", "usage", "sync"]);
      nextSync = Date.now() + 5000;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const pending = status().unified.usage;
  throw new Error(
    `Timed out waiting for ${label}; open=${pending.open_dimensions}, queued=${pending.queued_batches}, dropped=${pending.dropped}, collecting=${pending.collect_opt_in}`,
  );
}
let cleanupVerified = false;
let proofError;
let cleanupError;
try {
  run(["telemetry", "enable"]);
  assert.equal(status().installation_id, null, "notice-only created a remote identity");
  const baseline = run(["report", "--json"]);
  assert.equal(status().unsent_invocations, 0, "unconsented command counted");
  if (!unifiedOnly) {
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
  }
  if (additional) {
    const before = status().unified;
    for (const purpose of ["usage", "history", "publication", "profile"]) {
      run(["telemetry", purpose, "enable"]);
      assert.equal(status().unified[purpose].decision, before[purpose].decision);
    }
    run(["telemetry", "usage", "enable", "--accept", "palamedes-events-v1"], {
      PALAMEDES_OFFLINE: "1",
    });
    const unifiedReport = run(["report", "--json"], { PALAMEDES_OFFLINE: "1" });
    assert.equal(unifiedReport.stdout, baseline.stdout);
    assert.equal(unifiedReport.stderr, baseline.stderr);
    assert.equal(status().unsent_invocations, 0, "one invocation entered both streams");
    const view = JSON.parse(run(["telemetry", "usage", "preview"]).stdout);
    assert.equal(view.open.length, 1);
    assert.equal(view.open[0].count, 1);
    assert.equal(view.open[0].dimensions.command, "report");
    await waitForUnified(
      (s) => s.usage.open_dimensions === 0 && s.usage.queued_batches === 0,
      "unified batch acknowledgement",
    );
    assert.equal(status().unified.usage.dropped, 0);
    await unifiedChoice("history", "enable", "granted", "monthly-history-v1");
    await unifiedChoice("publication", "enable", "granted", "public-usage-v1");
    await unifiedChoice("profile", "enable", "granted", "profile-linking-v1");
    await unifiedChoice("publication", "disable", "declined");
    assert.equal(status().unified.history.decision, "granted");
    assert.equal(status().unified.usage.collect_opt_in, true);
    await unifiedChoice("profile", "disable", "declined");
    assert.equal(status().unified.history.decision, "granted");
    await unifiedChoice("profile", "enable", "granted", "profile-linking-v1");
    run(["telemetry", "profile", "reset", "--all-tools"]);
    await waitForUnified((s) => !s.profile_reset_pending, "shared profile reset");
    assert.equal(status().unified.usage.collect_opt_in, true);
    await unifiedChoice("history", "disable", "declined");
    run(["telemetry", "usage", "disable"]);
    run(["report", "--json"]);
    const withdrawn = status();
    assert.equal(withdrawn.unsent_invocations, 0);
    assert.equal(withdrawn.unified.usage.collect_opt_in, false);
    assert.equal(withdrawn.unified.usage.open_dimensions, 0);
    console.log(
      JSON.stringify({
        unifiedUploadAcknowledged: true,
        separateChoicesAcknowledged: true,
        publicationWithdrawalPreservedHistory: true,
        unlinkPreservedUsage: true,
        sharedResetAcknowledged: true,
        unifiedWithdrawalRespected: true,
      }),
    );
  }
} catch (error) {
  proofError = error;
}
try {
  let profileResetError;
  if (additional) {
    try {
      run(["telemetry", "profile", "reset", "--all-tools"]);
      await waitForUnified((s) => !s.profile_reset_pending, "cleanup shared profile reset");
    } catch (error) {
      profileResetError = error;
    }
  }
  run(["telemetry", "delete"]);
  const deleted = await waitFor(
    (s) =>
      ["confirmed", "no_active_record", "no_remote_identity"].includes(s.deletion) &&
      (!additional || !s.unified.usage.deletion_pending),
    "deletion acknowledgement",
    { flush: true },
  );
  assert.equal(deleted.unsent_invocations, 0);
  if (profileResetError) throw profileResetError;
  cleanupVerified = true;
  console.log(JSON.stringify({ syntheticDeletionAcknowledged: true, deletion: deleted.deletion }));
} catch (error) {
  cleanupError = error;
} finally {
  if (cleanupVerified) rmSync(fixture, { recursive: true, force: true });
  else console.error(`Synthetic cleanup is not confirmed; private state retained at ${fixture}.`);
}
const errors = [proofError, cleanupError].filter(Boolean);
if (errors.length > 0)
  throw new AggregateError(errors, "Synthetic lifecycle proof or cleanup failed");
