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
const endpoint = "https://sebastian-app-tracking.b-cdn.net/v1/versions/palamedes/github/stable";

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

export function assertEnabledCacheContents(text) {
  const state = JSON.parse(text);
  assert.equal(state.schema_version, 1);
  assert.equal(state.resource, endpoint);
  assert.ok(Number.isSafeInteger(state.next_check) && state.next_check > 0);
  assert.ok(Number.isInteger(state.failures) && state.failures >= 1 && state.failures <= 5);
  assert.equal(state.release, null);
}

export function enabledBuildArtifacts(stdout) {
  const messages = stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const artifact = messages.find(
    (message) =>
      message.reason === "compiler-artifact" &&
      message.target.name === "pmds" &&
      message.executable,
  );
  assert.ok(artifact, "Cargo must report the pmds executable");
  const build = messages.find(
    (message) =>
      message.reason === "build-script-executed" && message.package_id === artifact.package_id,
  );
  assert.ok(build?.out_dir, "Cargo must report the CLI catalog output directory");
  return { binary: artifact.executable, catalogDirectory: join(build.out_dir, "catalogs") };
}

function checkProcess(binary, catalogDirectory, version, optOut, dropOptOut) {
  const fixture = mkdtempSync(join(tmpdir(), "palamedes-enabled-update-check-"));
  try {
    const roots = ["home", "xdg-cache", "local-app-data"].map((name) => join(fixture, name));
    for (const root of roots) mkdirSync(root);
    // Deliberately do not inherit ambient opt-outs, proxies, or cache roots.
    const env = {
      HOME: roots[0],
      XDG_CACHE_HOME: roots[1],
      LOCALAPPDATA: roots[2],
      PALAMEDES_UI_LOCALE: "en",
      PALAMEDES_UI_CATALOG_DIR: catalogDirectory,
    };
    if (!dropOptOut) env[optOut] = optOut === "DO_NOT_TRACK" ? "1" : "0";
    const versionResult = spawnSync(binary, ["version"], {
      cwd: fixture,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(versionResult.error);
    assert.equal(versionResult.status, 0);
    assert.equal(
      versionResult.stdout,
      `pmds (Palamedes) v${version}\nFast i18n tooling for modern apps\n`,
    );
    assert.equal(versionResult.stderr, "");
    assertNoCache(roots);
    const result = spawnSync(binary, ["report"], {
      cwd: fixture,
      env,
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Could not find a Palamedes config/u);
    if (dropOptOut) {
      // This real due-check side effect proves the binary is enabled. It also
      // demonstrates that the same oracle rejects an ignored/missing opt-out.
      assert.throws(() => assertNoCache(roots), /unexpected cache write/u);
      assertEnabledCacheContents(
        readFileSync(
          join(roots[1], "palamedes", "app-tracking-updates", "palamedes.github.stable.json"),
          "utf8",
        ),
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
    const [binary, parentNamespace, version, catalogDirectory] = process.argv.slice(3);
    assert.ok(catalogDirectory, "the isolated proof requires the built UI catalogs");
    verifyIsolation(parentNamespace);
    console.log("Verified separate network namespace, down loopback, and no forwarding routes.");
    for (const optOut of ["DO_NOT_TRACK", "PALAMEDES_UPDATE_CHECK"]) {
      checkProcess(binary, catalogDirectory, version, optOut, false);
      checkProcess(binary, catalogDirectory, version, optOut, true);
    }
    return;
  }

  assert.equal(process.argv.length, 2, "unexpected enabled-check harness arguments");
  const targetDir = join(repositoryRoot, "target", "update-check-enabled");
  const stdout = execFileSync(
    "cargo",
    [
      "build",
      "-p",
      "palamedes-cli",
      "--bin",
      "pmds",
      "--locked",
      "--target-dir",
      targetDir,
      "--message-format=json-render-diagnostics",
    ],
    {
      cwd: repositoryRoot,
      env: { ...process.env, PALAMEDES_UPDATE_ENDPOINT: endpoint },
      stdio: ["inherit", "pipe", "inherit"],
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const { binary, catalogDirectory } = enabledBuildArtifacts(stdout);
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
      binary,
      readlinkSync("/proc/self/ns/net"),
      version,
      catalogDirectory,
    ],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
    },
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
