import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const mode = process.argv[2] ?? "smoke";
if (!["smoke", "scheduled"].includes(mode)) throw new Error("Use smoke or scheduled");
const nightly = "nightly-2026-07-20";
const targets = ["source", "config", "plugin"];
const budget = mode === "smoke" ? { runs: 1000, seconds: 20 } : { runs: 1_000_000, seconds: 300 };
const output = resolve(root, "fuzz/target");
await mkdir(output, { recursive: true });
const runRoot = await mkdtemp(resolve(output, "run-"));

async function run(command, args, { seconds = 1200, log, offline = false } = {}) {
  console.log(`> ${command} ${args.join(" ")}`);
  const stream = log ? createWriteStream(log) : undefined;
  let stdout = "";
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, CARGO_NET_OFFLINE: offline ? "true" : process.env.CARGO_NET_OFFLINE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    process.stdout.write(chunk);
    stream?.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
    stream?.write(chunk);
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), seconds * 1000);
  try {
    await new Promise((accept, reject) => {
      child.on("error", reject);
      child.on("exit", (code, signal) =>
        code === 0 ? accept() : reject(new Error(`${command} failed (${signal ?? code})`)),
      );
    });
  } finally {
    clearTimeout(timer);
    stream?.end();
  }
  return stdout;
}

const version = await run("cargo", ["fuzz", "--version"]);
if (version.trim() !== "cargo-fuzz 0.13.2") throw new Error("Install cargo-fuzz =0.13.2");
const compiler = await run("rustc", [`+${nightly}`, "-vV"]);
const triple = compiler.match(/^host: (.+)$/mu)?.[1];
if (!triple) throw new Error("Could not determine Rust host target");
const lockPath = resolve(root, "fuzz/Cargo.lock");
const checksum = async () =>
  createHash("sha256")
    .update(await readFile(lockPath))
    .digest("hex");
const lockBefore = await checksum();
// cargo-fuzz has no --locked passthrough. Fetch the committed graph first, then
// build offline and reject any lockfile change before executing generated input.
await run("cargo", [`+${nightly}`, "fetch", "--locked", "--manifest-path", "fuzz/Cargo.toml"]);
await run("cargo", [`+${nightly}`, "fuzz", "build", "--fuzz-dir", "fuzz", "--target-dir", output], {
  offline: true,
});
if ((await checksum()) !== lockBefore) throw new Error("Fuzz build changed the committed lockfile");
for (const target of targets) {
  const corpus = resolve(runRoot, target);
  await cp(resolve(root, "fuzz/seeds", target), corpus, { recursive: true });
  const artifacts = resolve(root, "fuzz/artifacts", target);
  await mkdir(artifacts, { recursive: true });
  await run(
    resolve(output, triple, "release", target),
    [
      corpus,
      "-seed=1311",
      `-runs=${budget.runs}`,
      `-max_total_time=${budget.seconds}`,
      "-max_len=65536",
      "-timeout=5",
      "-rss_limit_mb=2048",
      "-malloc_limit_mb=256",
      "-print_final_stats=1",
      `-artifact_prefix=${artifacts}/`,
    ],
    { seconds: budget.seconds + 15, log: resolve(output, `${target}-${mode}.log`) },
  );
}
