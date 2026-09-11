import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = mkdtempSync(join(root, ".next-fragment-proof-"));
const results = [];
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find((candidate) => candidate && existsSync(candidate));

function file(name, content) {
  const destination = join(fixture, name);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

function start(args) {
  return spawn(process.execPath, [join(fixture, "node_modules/next/dist/bin/next"), ...args], {
    cwd: fixture,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function build(bundler) {
  const child = start(["build", `--${bundler}`]);
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const status = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", done);
  });
  assert.equal(status, 0, output);
}

async function waitForServer(port, server) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (server.exitCode !== null) throw new Error("Next preview exited before becoming ready.");
    try {
      if ((await fetch(`http://127.0.0.1:${port}`)).ok) return;
    } catch {
      /* Wait for the listener. */
    }
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error("Next preview did not become ready.");
}

try {
  symlinkSync(join(root, "examples/nextjs-cookie/node_modules"), join(fixture, "node_modules"));
  file("package.json", JSON.stringify({ private: true, type: "module" }));
  file("next.config.mjs", `export default { turbopack: { root: ${JSON.stringify(root)} } };`);
  file(
    "app/layout.jsx",
    `export default function Layout({children}) { return <html lang="en"><body>{children}</body></html>; }`,
  );
  file(
    "app/page.jsx",
    `import Link from "next/link"; export default function Page() { return <main><h1>Healthy page</h1><Link href="/translated" prefetch={false}>Open translated route</Link></main>; }`,
  );
  file(
    "app/translated/page.jsx",
    `import Translated from "./translated"; export default function Page() { return <Translated />; }`,
  );
  file(
    "app/translated/fragment.js",
    `if (typeof window !== "undefined" && document.cookie.includes("rejectFragment=1")) throw new Error("PALAMEDES_PROOF_FRAGMENT_REJECTED"); export const message = "Compiled fragment ready";`,
  );
  file(
    "app/translated/translated.jsx",
    `"use client"; const fragment = await import("./fragment"); export default function Translated() { return <main><h1>{fragment.message}</h1></main>; }`,
  );
  file(
    "app/translated/error.jsx",
    `"use client"; export default function ErrorView() { return <main role="alert"><h1>Translation unavailable</h1><a href="/translated">Reload page</a><a href="/">Go home</a></main>; }`,
  );
  file(
    "app/global-error.jsx",
    `"use client"; export default function ErrorView() { return <html><body><main role="alert"><h1>Application unavailable</h1><a href="/">Go home</a></main></body></html>; }`,
  );

  for (const [index, bundler] of ["webpack", "turbopack"].entries()) {
    console.log(`Building ${bundler} fragment-rejection proof...`);
    await build(bundler);
    const staticRoot = join(fixture, ".next/static");
    const fragmentAssets = readdirSync(staticRoot, { recursive: true })
      .filter(
        (name) =>
          name.endsWith(".js") &&
          readFileSync(join(staticRoot, name), "utf8").includes(
            "PALAMEDES_PROOF_FRAGMENT_REJECTED",
          ),
      )
      .map((name) => `/_next/static/${name.replaceAll("\\", "/")}`);
    assert.ok(fragmentAssets.length > 0, "The proof needs a real emitted fragment asset.");
    const port = 4517 + index;
    const server = start(["start", "--hostname", "127.0.0.1", "--port", String(port)]);
    server.stdout.on("data", () => {});
    server.stderr.on("data", () => {});
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      await waitForServer(port, server);
      for (const failure of ["evaluation", "network"]) {
        for (const entry of ["initial", "navigation"]) {
          const context = await browser.newContext();
          if (failure === "evaluation")
            await context.addCookies([
              { name: "rejectFragment", value: "1", url: `http://127.0.0.1:${port}` },
            ]);
          let aborted = 0;
          if (failure === "network")
            await context.route("**/*", (route) => {
              if (fragmentAssets.includes(new URL(route.request().url()).pathname)) {
                aborted += 1;
                return route.abort("failed");
              }
              return route.continue();
            });
          const page = await context.newPage();
          const errors = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(`http://127.0.0.1:${port}${entry === "initial" ? "/translated" : "/"}`);
          if (entry === "navigation")
            await page.getByRole("link", { name: "Open translated route" }).click();
          let reachedErrorView = true;
          try {
            await page
              .getByRole("heading", { name: "Translation unavailable" })
              .waitFor({ timeout: 12_000 });
          } catch {
            reachedErrorView = false;
          }
          const body = await page.locator("body").innerText();
          if (failure === "network")
            assert.ok(aborted > 0, "A catalog asset request must actually fail.");
          results.push({ bundler, failure, entry, reachedErrorView, body, errors, aborted });
          console.log(JSON.stringify(results.at(-1)));
          if (reachedErrorView) {
            await context.clearCookies();
            await context.unrouteAll();
            await page.getByRole("link", { name: "Reload page" }).click();
            await page.getByRole("heading", { name: "Compiled fragment ready" }).waitFor();
          }
          await context.close();
        }
      }
    } finally {
      await browser.close();
      server.kill("SIGTERM");
      await new Promise((done) => {
        if (server.exitCode !== null) done();
        else server.once("exit", done);
      });
    }
    rmSync(join(fixture, ".next"), { recursive: true, force: true });
  }
  assert.ok(
    results.every((result) => result.reachedErrorView),
    JSON.stringify(results, null, 2),
  );
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
