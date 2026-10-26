import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once, on } from "node:events";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const run = promisify(execFile);

async function fixture(t) {
  // The development host needs the toolchain. Deployment isolation is tested
  // separately by backend.test.mjs, using installed production tarballs.
  const directory = await mkdtemp(path.join(os.tmpdir(), "palamedes-backend-development-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const file of [
    "src",
    "package.json",
    "palamedes.yaml",
    "tsconfig.json",
    "tsconfig.build.json",
    "vite.config.ts",
    "tsdown.config.ts",
    "rolldown.config.mjs",
  ])
    await cp(path.join(root, file), path.join(directory, file), { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  // Resolve pnpm's relative workspace links before linking each package.
  // Windows temp and checkout directories can be on different drives.
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
    const target = await realpath(path.join(root, "node_modules", name));
    const destination = path.join(directory, "node_modules", name);
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(target, destination, process.platform === "win32" ? "junction" : "dir");
  }
  return directory;
}

async function command(directory, args) {
  const [tool, ...parameters] = args;
  const name = { pmds: "@palamedes/cli", tsc: "typescript" }[tool] ?? tool;
  const packageDirectory = path.join(root, "node_modules", name);
  const manifest = JSON.parse(await readFile(path.join(packageDirectory, "package.json"), "utf8"));
  const bin = typeof manifest.bin === "string" ? manifest.bin : manifest.bin[tool];
  return run(process.execPath, [path.join(packageDirectory, bin), ...parameters], {
    cwd: directory,
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
  });
}

async function generate(directory) {
  await command(directory, ["pmds", "extract", "--runtime-manifest", ".palamedes/macros.json"]);
  await command(directory, [
    "pmds",
    "catalog",
    "compile",
    "--target",
    "js",
    "--output",
    ".palamedes/catalogs",
  ]);
}

async function cli(directory, entry, locale = "de") {
  try {
    return {
      code: 0,
      ...(await run(
        process.execPath,
        ["--enable-source-maps", entry, "show", "BK-1", "--locale", locale],
        {
          cwd: directory,
          env: { ...process.env, NODE_OPTIONS: "" },
          timeout: 20_000,
        },
      )),
    };
  } catch (error) {
    return error;
  }
}

async function nextWatchBuild(builds, changedFile) {
  while (true) {
    const completion = await builds.next();
    if (completion.done) break;
    const [line] = completion.value;
    const build = JSON.parse(line);
    if (!changedFile || build.changes.includes(changedFile)) return build;
  }
  assert.fail(`Watcher closed before rebuilding ${changedFile ?? "the initial output"}`);
}

test("watch completion waits for the edited input rather than a queued build", async () => {
  const completions = [
    { changes: [] },
    { changes: ["src/locales/de.po"] },
    { changes: ["src/locales/de.po"] },
    { changes: ["src/booking.ts"] },
    { changes: ["src/booking.ts"] },
    { changes: ["palamedes.yaml"] },
  ];
  async function* builds() {
    for (const completion of completions) yield [JSON.stringify(completion)];
  }
  const events = builds();
  assert.deepEqual(await nextWatchBuild(events), completions[0]);
  assert.deepEqual(await nextWatchBuild(events, "src/locales/de.po"), completions[1]);
  assert.deepEqual(await nextWatchBuild(events, "src/booking.ts"), completions[3]);
  assert.deepEqual(await nextWatchBuild(events, "palamedes.yaml"), completions[5]);
});

test("unbundled development regenerates source/catalog/config artifacts and restarts", async (t) => {
  const directory = await fixture(t);
  await generate(directory);
  assert.match((await cli(directory, "src/cli.ts")).stdout, /Buchungsdetails\./u);

  const source = path.join(directory, "src/cli.ts");
  const original = await readFile(source, "utf8");
  await writeFile(source, original.replace("Booking details.", "Updated booking details."));
  const stale = await cli(directory, "src/cli.ts", "en");
  assert.notEqual(stale.code, 0);
  assert.match(stale.stderr, /runtime macro manifest has no entry/u);
  assert.match(stale.stderr, /cli\.ts:\d+/u);
  await generate(directory);
  assert.match((await cli(directory, "src/cli.ts", "en")).stdout, /Updated booking details\./u);

  const catalog = path.join(directory, "src/locales/de.po");
  const german = await readFile(catalog, "utf8");
  await writeFile(catalog, german.replace("ist bestätigt.", "wurde aktualisiert."));
  await generate(directory);
  assert.match((await cli(directory, "src/cli.ts")).stdout, /wurde aktualisiert\./u);

  await rename(path.join(directory, "src/locales"), path.join(directory, "src/translations"));
  const config = path.join(directory, "palamedes.yaml");
  await writeFile(
    config,
    (await readFile(config, "utf8")).replace("src/locales/", "src/translations/"),
  );
  await generate(directory);
  await command(directory, ["tsc", "-p", "tsconfig.build.json"]);
  assert.match((await cli(directory, "build/cli.js")).stdout, /wurde aktualisiert\./u);

  const valid = await readFile(path.join(directory, "src/translations/de.po"), "utf8");
  await writeFile(
    path.join(directory, "src/translations/de.po"),
    valid.replace("wurde aktualisiert.", "{broken, plural,"),
  );
  await assert.rejects(generate(directory), (error) =>
    /(?:ICU|parse|plural|compile)/iu.test(error.stderr + error.stdout),
  );
  await writeFile(path.join(directory, "src/translations/de.po"), valid);
  await generate(directory);
  assert.match((await cli(directory, "build/cli.js")).stdout, /wurde aktualisiert\./u);
});

test("ESM startup fails clearly without the generated manifest", async (t) => {
  const directory = await fixture(t);
  const result = await cli(directory, "src/cli.ts");
  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /ENOENT.*macros\.json/u);
});

test("authored async source diagnostics survive every build path", async (t) => {
  const directory = await fixture(t);
  const file = path.join(directory, "src/booking.ts");
  const source = (await readFile(file, "utf8")).replace(
    "await setImmediate();",
    'await setImmediate();\n  if (id === "BK-1") throw new Error("Authored booking diagnostic");',
  );
  await writeFile(file, source);
  const line =
    source.split("\n").findIndex((value) => value.includes("Authored booking diagnostic")) + 1;
  await generate(directory);
  for (const [entry, build] of [
    ["src/cli.ts"],
    ["build/cli.js", ["tsc", "-p", "tsconfig.build.json"]],
    ["dist/cli.mjs", ["vite", "build"]],
    ["dist-tsdown/cli.mjs", ["tsdown"]],
    ["dist-rolldown/cli.mjs", ["rolldown", "--config", "rolldown.config.mjs"]],
  ]) {
    if (build) await command(directory, build);
    const result = await cli(directory, entry);
    assert.notEqual(result.code, 0, entry);
    assert.match(result.stderr, /Authored booking diagnostic/u, entry);
    assert.ok(result.stderr.includes(`booking.ts:${line}:`), `${entry}: ${result.stderr}`);
  }
});

test("standalone Rolldown watch rebuilds source, catalogs, and configuration", async (t) => {
  const active = {};
  const controller = new AbortController();
  // Node runs after hooks in registration order: stop watching before the
  // fixture cleanup removes files, especially on Windows.
  t.after(async () => {
    controller.abort();
    active.lines?.close();
    if (active.child && active.child.exitCode === null && active.child.signalCode === null) {
      const exited = once(active.child, "exit");
      active.child.kill();
      await exited;
    }
  });
  const directory = await fixture(t);
  await mkdir(path.join(directory, "test"));
  await writeFile(
    path.join(directory, "test/watch.mjs"),
    `
import { watch } from "rolldown";
import path from "node:path";
import config from "../rolldown.config.mjs";
const pending = new Set();
let changes = [];
config.plugins.push({
  name: "watch-build-inputs",
  watchChange(id) { pending.add(path.relative(process.cwd(), id).split(path.sep).join("/")); },
  buildStart() {
    changes = [...pending];
    pending.clear();
  },
});
const watcher = watch(config);
watcher.on("event", (event) => {
  if (event.code === "END") console.log(JSON.stringify({ changes }));
  if (event.code === "ERROR") { console.error(event.error); process.exitCode = 1; }
});
process.on("SIGTERM", async () => { await watcher.close(); process.exit(); });
`,
  );
  active.child = spawn(process.execPath, ["test/watch.mjs"], {
    cwd: directory,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  active.child.stderr.setEncoding("utf8").on("data", (chunk) => {
    stderr += chunk;
  });
  active.lines = createInterface({ input: active.child.stdout });
  const builds = on(active.lines, "line", { signal: controller.signal });
  async function rebuilt(changedFile) {
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      // A preceding edit can produce more than one completion. Only accept a
      // build whose input snapshot includes this edit's watchChange event.
      await nextWatchBuild(builds, changedFile);
    } catch (error) {
      error.message += `\nWaiting for ${changedFile ?? "the initial build"}\n${stderr}`;
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  await rebuilt();
  assert.match((await cli(directory, "dist-rolldown/cli.mjs")).stdout, /ist bestätigt\./u);
  const catalog = path.join(directory, "src/locales/de.po");
  await writeFile(
    catalog,
    (await readFile(catalog, "utf8")).replace("ist bestätigt.", "wurde aktualisiert."),
  );
  await rebuilt("src/locales/de.po");
  assert.match((await cli(directory, "dist-rolldown/cli.mjs")).stdout, /wurde aktualisiert\./u);

  const source = path.join(directory, "src/booking.ts");
  await writeFile(source, (await readFile(source, "utf8")).replace("amount: 149", "amount: 199"));
  await rebuilt("src/booking.ts");
  assert.match((await cli(directory, "dist-rolldown/cli.mjs", "en")).stdout, /199\.00/u);

  await cp(path.join(directory, "src/locales"), path.join(directory, "src/translations"), {
    recursive: true,
  });
  const translated = path.join(directory, "src/translations/de.po");
  await writeFile(
    translated,
    (await readFile(translated, "utf8")).replace(
      "wurde aktualisiert.",
      "nutzt neue Konfiguration.",
    ),
  );
  const config = path.join(directory, "palamedes.yaml");
  await writeFile(
    config,
    (await readFile(config, "utf8")).replace("src/locales/", "src/translations/"),
  );
  await rebuilt("palamedes.yaml");
  assert.match(
    (await cli(directory, "dist-rolldown/cli.mjs")).stdout,
    /nutzt neue Konfiguration\./u,
  );
});
