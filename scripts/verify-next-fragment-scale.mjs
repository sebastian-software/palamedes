import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const fixtureParent = path.join(root, ".palamedes");
const locales = ["en", "de", "es", "fr", "it", "pt", "ja", "ko", "zh-Hans", "zh-Hant"];
const moduleCount = 100;
const messageCount = 9000;
const memoryLimitKiB = 4 * 1024 * 1024;
const timeoutMs = 90_000;

assert.ok(
  process.platform === "linux" || process.platform === "darwin",
  "The scale proof needs ps process-tree accounting.",
);
await mkdir(fixtureParent, { recursive: true });
const fixture = await mkdtemp(path.join(fixtureParent, "next-fragment-scale-"));
let build;
let monitor;
let output = "";
let peakKiB = 0;
let stopReason;

function snapshot() {
  return execFileSync("ps", ["-axo", "pid=,ppid=,rss=,pgid="], { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.trim().split(/\s+/u).map(Number));
}

function ownedProcesses(rows) {
  const owned = new Set([build.pid]);
  let previousSize;
  do {
    previousSize = owned.size;
    for (const [pid, parent, , group] of rows)
      if (owned.has(parent) || group === build.pid) owned.add(pid);
  } while (owned.size !== previousSize);
  return owned;
}

function stopGroup(signal) {
  // macOS may report EPERM rather than ESRCH for an empty process group.
  if (!snapshot().some((row) => row[3] === build.pid)) return;
  try {
    process.kill(-build.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

try {
  await Promise.all(
    ["app", "components", "locales"].map((directory) => mkdir(path.join(fixture, directory))),
  );
  await symlink(
    path.join(root, "examples/nextjs-cookie/node_modules"),
    path.join(fixture, "node_modules"),
    "dir",
  );
  await writeFile(
    path.join(fixture, "package.json"),
    JSON.stringify({ name: "palamedes-next-fragment-scale", private: true, type: "module" }),
  );
  await writeFile(
    path.join(fixture, "palamedes.yaml"),
    `locales: ${JSON.stringify(locales)}\nsource-locale: en\nfallback-locales: [en]\ncatalogs:\n  - path: locales/{locale}\n    include: [components]\n`,
  );
  const messages = Array.from(
    { length: messageCount },
    (_, index) =>
      `Memory probe message ${String(index).padStart(5, "0")} with a representative static label and enough catalog content.`,
  );
  await Promise.all(
    locales.map(async (locale) => {
      const header = `msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n"Language: ${locale}\\n"\n\n`;
      const entries = messages
        .map(
          (message) =>
            `msgid ${JSON.stringify(message)}\nmsgstr ${JSON.stringify(`${locale} ${message}`)}`,
        )
        .join("\n\n");
      await writeFile(path.join(fixture, "locales", `${locale}.po`), `${header}${entries}\n`);
    }),
  );
  await Promise.all(
    Array.from({ length: moduleCount }, (_, index) =>
      writeFile(
        path.join(fixture, "components", `probe${index}.jsx`),
        `"use client";\nimport { t } from "@palamedes/core/macro";\nexport default function Probe${index}() { return <p>{t\`${messages[index]}\`}</p>; }\n`,
      ),
    ),
  );
  await writeFile(
    path.join(fixture, "app/page.jsx"),
    `${Array.from(
      { length: moduleCount },
      (_, index) => `import Probe${index} from "../components/probe${index}";`,
    ).join(
      "\n",
    )}\nexport default function Page() { return <main>${Array.from({ length: moduleCount }, (_, index) => `<Probe${index}/>`).join("")}</main>; }\n`,
  );
  await writeFile(
    path.join(fixture, "app/layout.jsx"),
    'import { createNextServerI18n } from "@palamedes/next-plugin/server";\nexport const dynamic = "force-dynamic";\nexport default async function Layout({ children }) { await createNextServerI18n({ locale: "de" }); return <html lang="de"><body>{children}</body></html>; }\n',
  );
  await writeFile(
    path.join(fixture, "next.config.mjs"),
    'import { withPalamedes } from "@palamedes/next-plugin";\nexport default withPalamedes({ experimental: { cpus: 2 } }, { serverFunctions: false });\n',
  );
  const started = performance.now();
  build = spawn(
    process.execPath,
    [
      path.join(root, "examples/nextjs-cookie/node_modules/next/dist/bin/next"),
      "build",
      fixture,
      "--turbopack",
    ],
    {
      cwd: root,
      detached: true,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", TURBO_TASKS_AVAILABLE_PARALLELISM: "2" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  for (const stream of [build.stdout, build.stderr])
    stream.on("data", (chunk) => {
      output = (output + chunk).slice(-40_000);
    });
  monitor = setInterval(() => {
    try {
      const rows = snapshot();
      const owned = ownedProcesses(rows);
      const total = rows.reduce((sum, [pid, , rss]) => sum + (owned.has(pid) ? rss : 0), 0);
      peakKiB = Math.max(peakKiB, total);
      if (total > memoryLimitKiB || performance.now() - started > timeoutMs) {
        stopReason ??=
          total > memoryLimitKiB ? "process-tree RSS exceeded 4 GiB" : "build exceeded 90 seconds";
        stopGroup("SIGKILL");
      }
    } catch (error) {
      stopReason ??= `Process monitoring failed: ${error.message}`;
      stopGroup("SIGKILL");
    }
  }, 100);
  const [code, signal] = await once(build, "exit");
  clearInterval(monitor);
  assert.equal(stopReason, undefined, `${stopReason}\n${output}`);
  assert.equal(code, 0, `Next build failed (${signal ?? code}):\n${output}`);
  assert.ok((await readFile(path.join(fixture, ".next/BUILD_ID"), "utf8")).trim());
  console.log(
    JSON.stringify({
      bundler: "turbopack",
      modules: moduleCount,
      locales: locales.length,
      messages: messageCount,
      seconds: Math.round((performance.now() - started) / 10) / 100,
      peakProcessTreeRssMiB: Math.round(peakKiB / 1024),
      rssLimitMiB: memoryLimitKiB / 1024,
    }),
  );
} finally {
  clearInterval(monitor);
  if (build) {
    stopGroup("SIGKILL");
    const cleanupDeadline = performance.now() + 3000;
    while (snapshot().some((row) => row[3] === build.pid) && performance.now() < cleanupDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      !snapshot().some((row) => row[3] === build.pid),
      "Build descendants are still running.",
    );
  }
  await rm(fixture, { recursive: true, force: true });
}
