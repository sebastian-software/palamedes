// This proof must never execute an enabled CLI in the host network namespace.
// Build with network access first, then independently verify Linux isolation
// before starting any pmds process, including the dropped-opt-out controls.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..");
const endpoint = "https://version-service.sebastian-software.de/check";

export function assertNetworkIsolation({
  parentNamespace,
  namespace,
  links,
  ipv4Routes,
  ipv6Routes,
}) {
  assert.match(parentNamespace, /^net:\[\d+\]$/u, "a parent network namespace is required");
  assert.match(namespace, /^net:\[\d+\]$/u);
  assert.notEqual(namespace, parentNamespace, "refusing the host network namespace");
  assert.equal(links.length, 1, "isolated namespace must have only loopback");
  assert.equal(links[0].ifname, "lo");
  assert.ok(!links[0].flags.includes("UP"), "isolated loopback must remain down");
  // Some kernels expose non-forwarding placeholder routes in a fresh namespace.
  for (const route of [...ipv4Routes, ...ipv6Routes]) {
    assert.ok(
      ["unreachable", "blackhole", "prohibit", "throw"].includes(route.type),
      "isolated namespace must have no forwarding routes",
    );
  }
}

function verifyIsolation(parentNamespace) {
  assert.equal(process.platform, "linux", "enabled-process proof requires Linux network isolation");
  const ipJson = (args) => JSON.parse(execFileSync("ip", ["-json", ...args], { encoding: "utf8" }));
  assertNetworkIsolation({
    parentNamespace,
    namespace: readlinkSync("/proc/self/ns/net"),
    links: ipJson(["link", "show"]),
    ipv4Routes: ipJson(["-4", "route", "show", "table", "all"]),
    ipv6Routes: ipJson(["-6", "route", "show", "table", "all"]),
  });
}

function assertNoCache(roots) {
  for (const root of roots) {
    assert.deepEqual(readdirSync(root), [], `unexpected cache write under ${root}`);
  }
}

export function assertEnabledCacheContents(timestamp, cohort) {
  assert.match(timestamp, /^\d+\n$/u);
  assert.match(cohort, /^\d{4}-\d{2}\n$/u);
}

function checkProcess(binary, version, optOut, dropOptOut) {
  const fixture = mkdtempSync(join(tmpdir(), "palamedes-enabled-update-check-"));
  try {
    const roots = ["home", "xdg-cache", "local-app-data"].map((name) => join(fixture, name));
    for (const root of roots) mkdirSync(root);
    // Deliberately do not inherit ambient opt-outs, proxies, or cache roots.
    const env = { HOME: roots[0], XDG_CACHE_HOME: roots[1], LOCALAPPDATA: roots[2] };
    if (!dropOptOut) env[optOut] = optOut === "DO_NOT_TRACK" ? "1" : "0";
    const result = spawnSync(binary, ["version"], {
      cwd: fixture,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0);
    assert.equal(result.signal, null);
    assert.equal(
      result.stdout,
      `pmds (Palamedes) v${version}\nFast i18n tooling for modern apps\n`,
    );
    assert.equal(result.stderr, "");
    if (dropOptOut) {
      // This real due-check side effect proves the binary is enabled. It also
      // demonstrates that the same oracle rejects an ignored/missing opt-out.
      assert.throws(() => assertNoCache(roots), /unexpected cache write/u);
      assertEnabledCacheContents(
        readFileSync(join(roots[1], "palamedes", "update-check-v1"), "utf8"),
        readFileSync(join(roots[1], "palamedes", "installed-since-v1"), "utf8"),
      );
    } else {
      assertNoCache(roots);
    }
    console.log(
      `${optOut}: ${dropOptOut ? "dropped-opt-out control rejected" : "output and no-cache contract passed"}`,
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function main() {
  assert.equal(
    process.platform,
    "linux",
    "enabled-process proof requires Linux; no binary was executed",
  );
  if (process.argv[2] === "--isolated") {
    const [binary, parentNamespace, version] = process.argv.slice(3);
    verifyIsolation(parentNamespace);
    console.log("Verified separate network namespace, down loopback, and no forwarding routes.");
    for (const optOut of ["DO_NOT_TRACK", "PALAMEDES_UPDATE_CHECK"]) {
      checkProcess(binary, version, optOut, false);
      checkProcess(binary, version, optOut, true);
    }
    return;
  }

  assert.equal(process.argv.length, 2, "unexpected enabled-check harness arguments");
  const targetDir = join(repositoryRoot, "target", "update-check-enabled");
  execFileSync(
    "cargo",
    ["build", "-p", "palamedes-cli", "--bin", "pmds", "--locked", "--target-dir", targetDir],
    {
      cwd: repositoryRoot,
      env: { ...process.env, PALAMEDES_UPDATE_ENDPOINT: endpoint },
      stdio: "inherit",
    },
  );
  const manifest = readFileSync(join(repositoryRoot, "crates/palamedes-cli/Cargo.toml"), "utf8");
  const version = manifest.match(/^version = "([^"]+)"$/mu)?.[1];
  assert.ok(version, "CLI version must come from its Cargo manifest");
  execFileSync(
    "sudo",
    [
      "-n",
      "unshare",
      "--net",
      process.execPath,
      import.meta.filename,
      "--isolated",
      join(targetDir, "debug", "pmds"),
      readlinkSync("/proc/self/ns/net"),
      version,
    ],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
