import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const packageDir = path.resolve(import.meta.dirname, "..");
const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function ensureBuiltPackage() {
  if (
    existsSync(path.join(packageDir, "dist", "index.mjs")) &&
    existsSync(path.join(packageDir, "dist", "index.cjs"))
  ) {
    return;
  }
  execFileSync(packageManager, ["build"], {
    cwd: packageDir,
    stdio: "pipe",
  });
}

test("the packed wrapper pins every native optional dependency exactly", (context) => {
  const archiveDir = mkdtempSync(path.join(os.tmpdir(), "palamedes-core-node-pack-"));
  context.after(() => rmSync(archiveDir, { recursive: true, force: true }));

  execFileSync(packageManager, ["pack", "--pack-destination", archiveDir], {
    cwd: packageDir,
    env: { ...process.env, npm_config_cache: path.join(archiveDir, "npm-cache") },
    shell: process.platform === "win32",
    stdio: "pipe",
  });
  const archive = readdirSync(archiveDir).find((entry) => entry.endsWith(".tgz"));
  assert.ok(archive, "npm pack did not produce an archive");

  const manifest = JSON.parse(
    execFileSync("tar", ["-xOzf", path.join(archiveDir, archive), "package/package.json"], {
      encoding: "utf8",
    }),
  );
  const platformPackages = Object.entries(manifest.optionalDependencies).filter(([name]) =>
    name.startsWith("@palamedes/core-node-"),
  );
  assert.equal(platformPackages.length, 6);
  for (const [name, version] of platformPackages) {
    assert.equal(version, manifest.version, `${name} must be pinned in the packed manifest`);
  }

  assert.equal(
    readFileSync(path.join(packageDir, "package.json"), "utf8").includes("workspace:*"),
    true,
  );
});

test("built ESM and CJS wrappers share process-wide coordination", async (context) => {
  ensureBuiltPackage();
  const require = (await import("node:module")).createRequire(import.meta.url);
  const esm = await import(pathToFileURL(path.join(packageDir, "dist", "index.mjs")).href);
  const cjs = require(path.join(packageDir, "dist", "index.cjs"));
  assert.equal(typeof esm.compileCatalogArtifactSelectedAsync, "function");
  assert.equal(typeof cjs.compileCatalogArtifactSelectedAsync, "function");
  assert.equal(typeof esm.updateCatalogFileAsync, "function");
  assert.equal(typeof cjs.updateCatalogFileAsync, "function");

  // The holder is lazy so importing either format remains side-effect free.
  // Prime it through a real built API before installing deterministic gates.
  await Promise.allSettled([
    esm.compileCatalogArtifactSelectedAsync(
      { rootDir: ".", locales: ["en"], sourceLocale: "en", catalogs: [] },
      "missing.po",
      ["missing"],
    ),
  ]);
  const processState = globalThis[Symbol.for("palamedes.core-node.process-state.v1")];
  assert.ok(processState, "built wrappers must initialize their process state holder");

  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-core-node-formats-"));
  context.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  const resourcePath = path.join(fixtureRoot, "missing.po");
  const compileConfig = {
    rootDir: fixtureRoot,
    locales: ["en"],
    sourceLocale: "en",
    catalogs: [],
  };
  const compileKey = JSON.stringify({
    rootDir: path.resolve(compileConfig.rootDir),
    resourcePath: path.resolve(resourcePath),
    locales: compileConfig.locales,
    sourceLocale: compileConfig.sourceLocale,
    catalogs: compileConfig.catalogs,
  });
  let releaseCompileGate;
  const compileGate = new Promise((resolve) => {
    releaseCompileGate = resolve;
  });
  processState.initialCatalogBuilds.set(compileKey, compileGate);
  context.after(() => {
    releaseCompileGate?.({ ok: false });
    processState.initialCatalogBuilds.delete(compileKey);
  });

  let esmCompileSettled = false;
  let cjsCompileSettled = false;
  const esmCompile = esm
    .compileCatalogArtifactSelectedAsync(compileConfig, resourcePath, ["missing"])
    .finally(() => {
      esmCompileSettled = true;
    });
  const cjsCompile = cjs
    .compileCatalogArtifactSelectedAsync(compileConfig, resourcePath, ["missing"])
    .finally(() => {
      cjsCompileSettled = true;
    });
  const compileCalls = [esmCompile, cjsCompile];
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    esmCompileSettled,
    false,
    "the built ESM wrapper must wait for the shared selected-build coordinator",
  );
  assert.equal(
    cjsCompileSettled,
    false,
    "the built CJS wrapper must wait for the shared selected-build coordinator",
  );
  releaseCompileGate?.({ ok: true });
  await Promise.allSettled(compileCalls);
  processState.initialCatalogBuilds.delete(compileKey);

  const targetPath = path.join(fixtureRoot, "messages.po");
  const mutationKey = path.join(realpathSync(fixtureRoot), "messages.po");
  let releaseMutationGate;
  const mutationGate = new Promise((resolve) => {
    releaseMutationGate = resolve;
  });
  processState.mutationTails.set(mutationKey, mutationGate);
  context.after(() => {
    releaseMutationGate?.();
    processState.mutationTails.delete(mutationKey);
  });
  const mutationRequest = {
    targetPath,
    locale: "en",
    sourceLocale: "en",
    clean: false,
    messages: [{ message: "hello", extractedComments: [], origins: [] }],
  };
  let esmMutationSettled = false;
  let cjsMutationSettled = false;
  const esmMutation = esm.updateCatalogFileAsync(mutationRequest).finally(() => {
    esmMutationSettled = true;
  });
  const cjsMutation = cjs.updateCatalogFileAsync(mutationRequest).finally(() => {
    cjsMutationSettled = true;
  });
  const mutationCalls = [esmMutation, cjsMutation];
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(
    esmMutationSettled,
    false,
    "the built ESM wrapper must wait for the shared mutation queue",
  );
  assert.equal(
    cjsMutationSettled,
    false,
    "the built CJS wrapper must wait for the shared mutation queue",
  );
  releaseMutationGate?.();
  await Promise.all(mutationCalls);
  processState.mutationTails.delete(mutationKey);
});
