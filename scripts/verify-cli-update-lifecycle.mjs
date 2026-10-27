// Real enabled binary/package proof. Cached cases never need a remote request;
// --stalled-proxy additionally exercises a silent local HTTP CONNECT proxy.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const endpoint = "https://sebastian-app-tracking.b-cdn.net/v1/versions/palamedes/github/stable";
const notice = /pmds: Palamedes 99\.0\.0 is available[^\n]*\n/u;

export async function verifyCliUpdateLifecycle(binary, catalogDirectory, { stalled = false } = {}) {
  const fixture = mkdtempSync(join(tmpdir(), "palamedes-update-lifecycle-"));
  const launch = /\.(?:c|m)?js$/u.test(binary) ? process.execPath : binary;
  const prefix = launch === binary ? [] : [binary];
  const samples = [];
  try {
    mkdirSync(join(fixture, "app"));
    mkdirSync(join(fixture, "locales"));
    writeFileSync(
      join(fixture, "app/main.ts"),
      "import {t} from '@palamedes/core/macro'; export function title() { return t`Hello`; }\n",
    );
    writeFileSync(
      join(fixture, "palamedes.yaml"),
      "locales: [en]\nsource-locale: en\ncatalogs:\n  - path: locales/{locale}\n    include: [app]\n",
    );
    writeFileSync(join(fixture, "locales/en.po"), 'msgid "Hello"\nmsgstr "Hello"\n');
    function profile(name) {
      const home = join(fixture, name);
      mkdirSync(home);
      const env = {
        HOME: home,
        XDG_CACHE_HOME: home,
        LOCALAPPDATA: home,
        PALAMEDES_UI_LOCALE: "en",
        PALAMEDES_UI_CATALOG_DIR: catalogDirectory,
        PALAMEDES_TELEMETRY: "off",
      };
      for (const name of ["PATH", "SystemRoot", "TMPDIR"])
        if (process.env[name]) env[name] = process.env[name];
      const cache = join(
        home,
        ...(process.platform === "darwin" ? ["Library", "Caches"] : []),
        "palamedes/app-tracking-updates/palamedes.github.stable.json",
      );
      return { env, cache };
    }
    function seed(p) {
      const now = Date.now();
      mkdirSync(resolve(p.cache, ".."), { recursive: true });
      writeFileSync(
        p.cache,
        JSON.stringify({
          schema_version: 1,
          resource: endpoint,
          next_check: Math.floor(now / 1000) + 1800,
          failures: 0,
          etag: null,
          noticed_version: null,
          noticed_at: 0,
          release: {
            schema_version: 1,
            tool_id: "palamedes",
            distribution: "github",
            channel: "stable",
            latest_version: "99.0.0",
            published_at: new Date(now - 7_200_000).toISOString(),
            checked_at: new Date(now).toISOString(),
            stale: false,
            release_url: "https://github.com/sebastian-software/palamedes/releases/tag/v99.0.0",
          },
        }),
      );
    }
    async function run(p, settings, args = ["report", "--json"]) {
      const start = performance.now();
      const child = spawn(launch, [...prefix, ...args], {
        cwd: fixture,
        env: { ...p.env, ...settings },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data) => {
        stdout += data;
      });
      child.stderr.on("data", (data) => {
        stderr += data;
      });
      const timer = setTimeout(() => child.kill(), 10_000);
      try {
        const [code, signal] = await once(child, "close");
        assert.equal(signal, null, `CLI did not finish: ${stderr}`);
        return { code, stdout, stderr, ms: performance.now() - start };
      } finally {
        clearTimeout(timer);
      }
    }
    const baseline = await run(profile("baseline"), { PALAMEDES_UPDATE_CHECK: "0" });
    assert.equal(baseline.code, 0, baseline.stderr);
    JSON.parse(baseline.stdout);
    const cases = [
      ["disabled", { PALAMEDES_UPDATE_CHECK: "0" }, false],
      ["noninteractive", {}, false],
      ["ci-default", { CI: "1" }, false],
      ["offline", { PALAMEDES_UPDATE_CHECK: "1", PALAMEDES_OFFLINE: "1" }, false],
      ["do-not-track", { PALAMEDES_UPDATE_CHECK: "1", DO_NOT_TRACK: "1" }, false],
      ["cached", { PALAMEDES_UPDATE_CHECK: "1" }, true],
      ["ci-explicit", { CI: "1", PALAMEDES_UPDATE_CHECK: "1" }, true],
    ];
    for (const [name, settings, expectedNotice] of cases) {
      const times = [];
      for (let sample = 0; sample < 5; sample++) {
        const p = profile(`${name}-${sample}`);
        seed(p);
        const result = await run(p, settings);
        assert.equal(result.code, baseline.code, result.stderr);
        assert.equal(result.stdout, baseline.stdout);
        assert.equal(notice.test(result.stderr), expectedNotice, name);
        assert.equal(result.stderr.replace(notice, ""), baseline.stderr);
        assert.equal(
          JSON.parse(readFileSync(p.cache)).noticed_version,
          expectedNotice ? "99.0.0" : null,
        );
        times.push(Math.round(result.ms * 100) / 100);
        if (expectedNotice) {
          const repeated = await run(p, settings);
          assert.equal(repeated.stderr, baseline.stderr, "notice was not throttled");
        }
      }
      samples.push({ name, milliseconds: times });
    }
    const p = profile("watch");
    seed(p);
    const child = spawn(launch, [...prefix, "extract", "--watch"], {
      cwd: fixture,
      env: { ...p.env, PALAMEDES_UPDATE_CHECK: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const closed = once(child, "close");
    let stdout = "";
    let stderr = "";
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`watch missed its startup notice: ${stdout} ${stderr}`)),
          10_000,
        );
        const ready = () => {
          if (stdout.includes("Watching for changes...") && notice.test(stderr)) {
            clearTimeout(timer);
            resolve();
          }
        };
        child.stdout.on("data", (data) => {
          stdout += data;
          ready();
        });
        child.stderr.on("data", (data) => {
          stderr += data;
          ready();
        });
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", () => {
          clearTimeout(timer);
          reject(new Error(`watch exited early: ${stderr}`));
        });
      });
    } finally {
      child.kill(process.platform === "win32" ? undefined : "SIGINT");
      await closed;
    }
    assert.equal(
      (await run(p, { PALAMEDES_UPDATE_CHECK: "1" })).stderr,
      baseline.stderr,
      "interrupted watch lost its displayed-notice throttle",
    );
    if (stalled) {
      const sockets = new Set();
      let connect = "";
      const proxy = createServer((socket) => {
        sockets.add(socket);
        socket.on("data", (data) => {
          connect += data;
        });
        socket.on("close", () => sockets.delete(socket));
      });
      proxy.listen(0, "127.0.0.1");
      await once(proxy, "listening");
      try {
        const p = profile("stalled-proxy");
        const settings = {
          PALAMEDES_UPDATE_CHECK: "1",
          HTTPS_PROXY: `http://127.0.0.1:${proxy.address().port}`,
          NO_PROXY: "",
        };
        const result = await run(p, settings);
        assert.match(
          connect,
          /CONNECT sebastian-app-tracking\.b-cdn\.net:443/u,
          "client did not use the stalled local proxy",
        );
        assert.equal(result.code, baseline.code);
        assert.equal(result.stdout, baseline.stdout);
        assert.equal(result.stderr, baseline.stderr);
        assert.ok(
          result.ms < 1500,
          `stalled update exceeded complete-process ceiling: ${result.ms} ms`,
        );
        assert.equal(JSON.parse(readFileSync(p.cache)).failures, 1);
        const connections = connect;
        const repeated = await run(p, settings);
        assert.equal(connect, connections, "backoff made another request");
        assert.equal(repeated.stdout, baseline.stdout);
        assert.equal(repeated.stderr, baseline.stderr);
        samples.push({
          name: "stalled-proxy",
          milliseconds: [result.ms],
          backoffMilliseconds: repeated.ms,
        });
      } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => proxy.close(resolve));
      }
    }
    console.log(
      JSON.stringify({
        binary,
        samples,
        watchNoticeBeforeInterruption: true,
        stdoutJsonAndExitPreserved: true,
      }),
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.ok(
    process.argv[2] && process.argv[3],
    "Usage: node scripts/verify-cli-update-lifecycle.mjs <binary-or-launcher> <UI-catalog-directory> [--stalled-proxy]",
  );
  await verifyCliUpdateLifecycle(resolve(process.argv[2]), resolve(process.argv[3]), {
    stalled: process.argv.includes("--stalled-proxy"),
  });
}
