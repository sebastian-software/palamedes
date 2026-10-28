import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";

const packageDir = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageDir, "..", "..");

function linkPackage(consumerRoot, packageName, target) {
  const linkPath = path.join(consumerRoot, "node_modules", ...packageName.split("/"));
  mkdirSync(path.dirname(linkPath), { recursive: true });
  symlinkSync(target, linkPath, process.platform === "win32" ? "junction" : "dir");
}

test("the packed package exposes a loadable ESM entry and no CommonJS entry", (context) => {
  const archiveDir = mkdtempSync(path.join(os.tmpdir(), "palamedes-react-router-pack-"));
  const consumerRoot = mkdtempSync(path.join(os.tmpdir(), "palamedes-react-router-consumer-"));
  context.after(() => {
    rmSync(archiveDir, { recursive: true, force: true });
    rmSync(consumerRoot, { recursive: true, force: true });
  });

  const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  execFileSync(packageManager, ["pack", "--pack-destination", archiveDir], {
    cwd: packageDir,
    env: { ...process.env, npm_config_cache: path.join(archiveDir, "npm-cache") },
    shell: process.platform === "win32",
    stdio: "pipe",
  });
  const archive = readdirSync(archiveDir).find((entry) => entry.endsWith(".tgz"));
  assert.ok(archive, "pnpm pack did not produce an archive");

  execFileSync("tar", ["-xzf", path.join(archiveDir, archive), "-C", consumerRoot], {
    stdio: "pipe",
  });
  const packedPackage = path.join(consumerRoot, "node_modules", "@palamedes", "react-router");
  mkdirSync(path.dirname(packedPackage), { recursive: true });
  renameSync(path.join(consumerRoot, "package"), packedPackage);

  const packedManifest = JSON.parse(readFileSync(path.join(packedPackage, "package.json"), "utf8"));
  assert.deepEqual(Object.keys(packedManifest.exports), ["."]);
  assert.deepEqual(packedManifest.exports["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.mjs",
  });
  assert.equal(packedManifest.main, undefined);
  assert.equal(packedManifest.module, undefined);
  // The router, its Node stream helper, and React belong to the application.
  for (const peer of ["react-router", "@react-router/node", "react", "react-dom"]) {
    assert.ok(packedManifest.peerDependencies[peer], `${peer} must be a peer dependency`);
    assert.equal(packedManifest.dependencies[peer], undefined);
  }
  for (const dependency of Object.values(packedManifest.dependencies)) {
    assert.ok(!dependency.startsWith("workspace:"), "pnpm pack must replace workspace ranges");
  }
  assert.equal(
    readdirSync(path.join(packedPackage, "dist")).some((entry) => entry.endsWith(".cjs")),
    false,
  );

  for (const name of ["runtime", "core", "vite-plugin"]) {
    linkPackage(consumerRoot, `@palamedes/${name}`, path.join(repositoryRoot, "packages", name));
  }
  for (const name of ["react-router", "@react-router/node", "react", "react-dom", "isbot"]) {
    linkPackage(consumerRoot, name, path.join(packageDir, "node_modules", ...name.split("/")));
  }

  const esmConsumer = path.join(consumerRoot, "consumer.mjs");
  writeFileSync(
    esmConsumer,
    `import { createReactRouterI18n } from "@palamedes/react-router"

const i18n = createReactRouterI18n({ resolveLocale: () => "en", catalogDelivery: false })
if (typeof i18n.middleware !== "function" || typeof i18n.handleRequest !== "function") {
  throw new Error("The ESM entry did not create the middleware and server entry")
}
`,
  );
  execFileSync(process.execPath, [esmConsumer], { cwd: consumerRoot, stdio: "pipe" });

  const commonJsConsumer = path.join(consumerRoot, "consumer.cjs");
  writeFileSync(
    commonJsConsumer,
    `try {
  require("@palamedes/react-router")
  throw new Error("CommonJS must not load the ESM-only package")
} catch (error) {
  if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
    throw error
  }
}
`,
  );
  const commonJsResult = spawnSync(process.execPath, [commonJsConsumer], {
    cwd: consumerRoot,
    encoding: "utf8",
  });
  assert.equal(commonJsResult.status, 0, commonJsResult.stderr);
});
