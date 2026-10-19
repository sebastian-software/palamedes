// Diagnostic characterization of the complete production examples container.
// The load is the existing repository smoke/browser contract corpus, not a
// capacity test or a model of production visitor traffic.
import assert from "node:assert/strict";
import { execFile, execFileSync, spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { EXAMPLE_MATRIX } from "../example-matrix.mjs";

const exec = promisify(execFile);
const output = path.resolve("resource-measurement");
await mkdir(output, { recursive: true });
const docker = (...args) => execFileSync("docker", args, { encoding: "utf8" }).trim();
const image = process.env.MEASURE_IMAGE;
assert.ok(image, "MEASURE_IMAGE is required");
assert.equal(EXAMPLE_MATRIX.length, 25);
const report = {
  createdAt: new Date().toISOString(),
  revision: process.env.GITHUB_SHA,
  sourceBase: "62cf1e9af6b20519d2671bde3c23c610abecc0f8",
  platform: {
    platform: os.platform(),
    architecture: os.arch(),
    node: process.version,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0].model,
    hostMemoryBytes: os.totalmem(),
  },
  image: JSON.parse(docker("image", "inspect", image))[0],
  examples: EXAMPLE_MATRIX.map(({ id, port }) => ({ id, port })),
  samples: [],
  phases: [],
  browser: [],
  smoke: [],
  scope:
    "One Linux amd64 production container; all 25 servers; browser and measurement driver run outside its cgroup. Existing smoke/browser contracts are the workload. No public deployment, CDN cache, Bunny sandbox overhead, or long-term capacity claim.",
};
// Preserve only non-sensitive image identity and build provenance.
report.image = {
  id: report.image.Id,
  sizeBytes: report.image.Size,
  architecture: report.image.Architecture,
  os: report.image.Os,
  labels: report.image.Config.Labels,
};
let container;
let phase = "startup";
let cgroup;
let sampling = true;
let sampler;
const start = performance.now();
const fields = (text) =>
  Object.fromEntries(
    text
      .trim()
      .split("\n")
      .map((line) => {
        const [key, value] = line.trim().split(/\s+/u);
        return [key, Number(value)];
      }),
  );
async function sample() {
  const [memory, stat, cpu, swap] = await Promise.all([
    readFile(path.join(cgroup, "memory.current"), "utf8"),
    readFile(path.join(cgroup, "memory.stat"), "utf8"),
    readFile(path.join(cgroup, "cpu.stat"), "utf8"),
    readFile(path.join(cgroup, "memory.swap.current"), "utf8"),
  ]);
  const ms = fields(stat);
  const value = {
    phase,
    elapsedMs: performance.now() - start,
    memoryCurrentBytes: Number(memory),
    inactiveFileBytes: ms.inactive_file ?? 0,
    workingSetBytes: Math.max(0, Number(memory) - (ms.inactive_file ?? 0)),
    anonymousBytes: ms.anon,
    cpuUsageUsec: fields(cpu).usage_usec,
    swapBytes: Number(swap),
  };
  report.samples.push(value);
  return value;
}
async function during(name, task) {
  phase = name;
  const before = await sample();
  const result = await task();
  const after = await sample();
  const samples = report.samples.filter((entry) => entry.phase === name);
  const memory = samples.map((entry) => entry.workingSetBytes).sort((a, b) => a - b);
  const elapsedSeconds = (after.elapsedMs - before.elapsedMs) / 1000;
  const summary = {
    name,
    elapsedSeconds,
    samples: samples.length,
    workingSetMinBytes: memory[0],
    workingSetMedianBytes: memory[Math.floor(memory.length / 2)],
    workingSetMaxBytes: memory.at(-1),
    memoryCurrentMaxBytes: Math.max(...samples.map((entry) => entry.memoryCurrentBytes)),
    cpuSeconds: (after.cpuUsageUsec - before.cpuUsageUsec) / 1e6,
    swapMaxBytes: Math.max(...samples.map((entry) => entry.swapBytes)),
    result,
  };
  summary.averageCpuCores = summary.cpuSeconds / elapsedSeconds;
  report.phases.push(summary);
  console.log(JSON.stringify(summary));
  return result;
}
function request(example, check) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: example.port,
        path: check.path,
        headers: check.headers,
        timeout: 15_000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            elapsedMs: performance.now() - started,
          }),
        );
      },
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error(`${example.id}: request timed out`)));
  });
}
async function smoke(example, check) {
  const response = await request(example, check);
  if (check.redirectTo) {
    assert.ok(response.status >= 300 && response.status < 400);
    assert.equal(
      new URL(response.headers.location, `http://127.0.0.1:${example.port}`).pathname,
      check.redirectTo,
    );
  } else assert.equal(response.status, 200, `${example.id} ${check.path}`);
  if (check.htmlLang)
    assert.equal(
      response.body.match(/<html\b[^>]*\blang=["']([^"']+)["']/iu)?.[1],
      check.htmlLang,
      example.id,
    );
  for (const text of check.substrings)
    assert.ok(response.body.includes(text), `${example.id}: missing ${text}`);
  return {
    id: example.id,
    path: check.path,
    status: response.status,
    bytes: Buffer.byteLength(response.body),
    elapsedMs: response.elapsedMs,
  };
}
async function smokeCorpus(parallelism) {
  const queue = EXAMPLE_MATRIX.flatMap((example) =>
    example.smokeChecks.map((check) => ({ example, check })),
  );
  const results = [];
  await Promise.all(
    Array.from({ length: parallelism }, async () => {
      while (queue.length) {
        const { example, check } = queue.shift();
        results.push(await smoke(example, check));
      }
    }),
  );
  report.smoke.push({ parallelism, results });
  return {
    requests: results.length,
    bytes: results.reduce((sum, result) => sum + result.bytes, 0),
  };
}
async function browserContracts(example) {
  const base = `http://127.0.0.1:${example.port}`;
  const env = {
    ...process.env,
    PALAMEDES_VERIFY_EXAMPLE_ID: example.id,
    PALAMEDES_VERIFY_BASE_URL: base,
    PALAMEDES_VERIFY_FRAMEWORK: example.framework,
    PALAMEDES_VERIFY_STRATEGY: example.strategy,
    PALAMEDES_VERIFY_HOST_MISMATCH_URL:
      example.strategy === "route" ? `http://de.lvh.me:${example.port}/en` : "",
    PALAMEDES_VERIFY_SUBDOMAIN_URL:
      example.strategy === "subdomain" ? `http://en.lvh.me:${example.port}/` : "",
    PALAMEDES_VERIFY_TLD_URL:
      example.strategy === "tld" ? `http://palamedes-i18n.com:${example.port}/` : "",
    PALAMEDES_CAPTURE_SCREENSHOTS: "0",
  };
  const child = spawn(
    "pnpm",
    [
      "exec",
      "vitest",
      "--config",
      "vitest.examples.config.mjs",
      "--run",
      "tests/examples-browser/examples.browser.test.js",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let logs = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      logs += chunk;
      process.stdout.write(chunk);
    });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  await writeFile(path.join(output, `${example.id}.browser.log`), logs);
  report.browser.push({ id: example.id, exitCode: code });
  assert.equal(code, 0, `${example.id}: browser contract failed`);
}
try {
  const args = EXAMPLE_MATRIX.flatMap((example) => [
    "-p",
    `127.0.0.1:${example.port}:${example.port}`,
  ]);
  container = docker("run", "-d", "--name", "examples-resources", ...args, image);
  const pid = docker("inspect", "--format", "{{.State.Pid}}", container);
  const membership = await readFile(`/proc/${pid}/cgroup`, "utf8");
  const relative = membership
    .split("\n")
    .find((line) => line.startsWith("0::"))
    ?.slice(3);
  assert.ok(relative, "This measurement requires Linux cgroup v2");
  cgroup = path.join("/sys/fs/cgroup", relative);
  report.cgroup = {
    path: relative,
    memoryMax: (await readFile(path.join(cgroup, "memory.max"), "utf8")).trim(),
    cpuMax: (await readFile(path.join(cgroup, "cpu.max"), "utf8")).trim(),
  };
  sampler = (async () => {
    for (;;) {
      if (!sampling) break;
      await sample();
      await delay(1000);
    }
  })().catch((error) => {
    report.samplingError = error.stack;
    sampling = false;
  });
  await during("startup-and-first-SSR", async () => {
    for (const example of EXAMPLE_MATRIX) {
      const deadline = performance.now() + 90_000;
      for (;;) {
        try {
          const response = await request(example, example.smokeChecks[0]);
          assert.ok(response.status >= 200 && response.status < 400);
          break;
        } catch (error) {
          if (performance.now() >= deadline) throw error;
          await delay(500);
        }
      }
    }
    return { readyServers: EXAMPLE_MATRIX.length };
  });
  await during("SSR-ready-idle-60s", () => delay(60_000));
  await during("existing-smoke-corpus-sequential", () => smokeCorpus(1));
  await during("browser-contract-warmup-all-25", async () => {
    for (const example of EXAMPLE_MATRIX) await browserContracts(example);
    return { examples: report.browser.length };
  });
  for (let index = 1; index <= 3; index++) {
    await during(`browser-warm-idle-${index}-60s`, () => delay(60_000));
  }
  for (let index = 1; index <= 3; index++) {
    await during(`existing-smoke-corpus-four-workers-${index}`, () => smokeCorpus(4));
  }
  await during("post-corpus-idle-60s", () => delay(60_000));
  report.memoryEvents = fields(await readFile(path.join(cgroup, "memory.events"), "utf8"));
  assert.ok(!report.samplingError, report.samplingError);
  report.success = true;
} catch (error) {
  report.success = false;
  report.error = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  sampling = false;
  await sampler;
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  if (container) {
    const { stdout, stderr } = await exec("docker", ["logs", container]);
    await writeFile(path.join(output, "container.log"), stdout + stderr);
    docker("rm", "-f", container);
  }
}
