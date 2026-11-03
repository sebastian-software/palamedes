// Checks that a standalone build with `experimentalClientCatalogAssets` still
// delivers client catalogs once it is deployed away from the project. It copies
// `.next/standalone` and `.next/static` to a temporary directory the way the
// Next docs prescribe, starts `server.js` from another working directory, and
// asserts that every locale's document carries the catalog map and that the
// server serves each message asset the map points to.
//
//   node scripts/check-next-client-catalog-standalone.mjs <example-dir> [dist-dir]
//
// The example serves each locale at `/<locale>`. The server listens on a free
// port unless `PORT` is set.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const exampleDir = path.resolve(process.argv[2] ?? ".");
const distName = process.argv[3] ?? ".next";
const distDir = path.join(exampleDir, distName);
const standaloneDir = path.join(distDir, "standalone");
assert.ok(
  existsSync(standaloneDir),
  `Missing ${standaloneDir}; build with output: "standalone" first`,
);

const serverFiles = JSON.parse(readFileSync(path.join(distDir, "required-server-files.json")));
const appDir = path.relative(serverFiles.config.outputFileTracingRoot, exampleDir);
const manifest = JSON.parse(readFileSync(path.join(distDir, "palamedes-client-catalogs.json")));

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForServer(origin, child, output) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    // Wait for this server's own ready line, so an unrelated server that
    // already holds the port cannot answer the check.
    if (!output.join("").includes("Ready")) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      continue;
    }
    try {
      await fetch(origin);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`The standalone server did not start:\n${output.join("")}`);
}

const deployDir = mkdtempSync(path.join(tmpdir(), "palamedes-next-standalone-"));
const output = [];
let server;
try {
  // Relocating the output proves that nothing still reads the project
  // directory, which a run from `.next/standalone` would hide.
  cpSync(standaloneDir, deployDir, { recursive: true, verbatimSymlinks: true });
  cpSync(path.join(distDir, "static"), path.join(deployDir, appDir, distName, "static"), {
    recursive: true,
  });

  const port = process.env.PORT ? Number(process.env.PORT) : await freePort();
  const origin = `http://127.0.0.1:${port}`;
  server = spawn(process.execPath, [path.join(deployDir, appDir, "server.js")], {
    cwd: tmpdir(),
    env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => output.push(chunk));
  server.stderr.on("data", (chunk) => output.push(chunk));
  await waitForServer(origin, server, output);

  let assets = 0;
  for (const [locale, expected] of Object.entries(manifest.locales)) {
    const response = await fetch(`${origin}/${locale}`);
    assert.equal(response.status, 200, `${locale} document: HTTP ${response.status}`);
    const html = await response.text();
    const map =
      /<script id="palamedes-client-catalogs" type="application\/json">(.*?)<\/script>/su.exec(
        html,
      )?.[1];
    assert.ok(map, `The standalone ${locale} document has no client catalog map`);
    assert.deepEqual(JSON.parse(map), { locale, assets: expected });

    for (const url of new Set(Object.values(expected))) {
      const asset = await fetch(new URL(url, origin));
      assert.equal(asset.status, 200, `${url}: HTTP ${asset.status}`);
      assert.match(
        await asset.text(),
        /\bmessages\b/u,
        `${url} does not look like a message asset`,
      );
      assets += 1;
    }
  }
  console.log(
    `[next-catalog-assets] standalone server outside the project rendered ${Object.keys(manifest.locales).length} locale maps and served ${assets} message assets`,
  );
} catch (error) {
  if (output.length > 0) console.error(`Standalone server output:\n${output.join("")}`);
  throw error;
} finally {
  server?.kill();
  rmSync(deployDir, { recursive: true, force: true });
}
