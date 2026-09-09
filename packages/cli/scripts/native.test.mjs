import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { forwardTerminalInterrupt, spawnNative } from "./native.mjs";

test("Windows terminal Ctrl+C relies on the shared console instead of hard-killing the child", () => {
  const forwarded = [];

  const handled = forwardTerminalInterrupt("win32", (signal) => {
    forwarded.push(signal);
    return true;
  });

  assert.equal(handled, false);
  assert.deepEqual(forwarded, []);
});

test("Unix terminal Ctrl+C is forwarded to the isolated native process group", () => {
  const forwarded = [];

  const handled = forwardTerminalInterrupt("linux", (signal) => {
    forwarded.push(signal);
    return true;
  });

  assert.equal(handled, true);
  assert.deepEqual(forwarded, ["SIGINT"]);
});

test(
  "Unix launcher signals reach the native child exactly once",
  { skip: process.platform === "win32" },
  async (context) => {
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const fixture = mkdtempSync(path.join(os.tmpdir(), "palamedes-native-signal-"));
      const marker = path.join(fixture, "ready");
      const receiver = path.join(fixture, "receiver.mjs");
      const launcher = path.join(fixture, "launcher.mjs");
      const nativeModule = new URL("native.mjs", import.meta.url).href;
      writeFileSync(
        receiver,
        `import { writeFileSync } from "node:fs"
let signals = 0
let finish
process.on(${JSON.stringify(signal)}, () => {
  signals += 1
  clearTimeout(finish)
  finish = setTimeout(() => {
    process.stdout.write(String(signals))
    process.exit(0)
  }, 150)
})
writeFileSync(${JSON.stringify(marker)}, "ready")
setInterval(() => {}, 1000)
`,
      );
      writeFileSync(
        launcher,
        `import { spawnNative } from ${JSON.stringify(nativeModule)}
const result = await spawnNative([${JSON.stringify(receiver)}], {
  nativeExecutable: process.execPath,
  captureOutput: true,
})
process.stdout.write(result.stdout)
process.exitCode = result.exitCode
`,
      );

      const child = spawn(process.execPath, [launcher], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      context.after(() => {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
        rmSync(fixture, { recursive: true, force: true });
      });

      await waitFor(() => existsSync(marker), 5000);
      process.kill(-child.pid, signal);
      const { code, signal: exitSignal } = await waitForExit(child, 5000);
      assert.equal(exitSignal, null);
      assert.equal(code, 0, stderr);
      assert.equal(stdout, "1");
    }
  },
);

test(
  "Unix launcher forwards repeated and escalating termination signals",
  { skip: process.platform === "win32" },
  async (context) => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "palamedes-native-escalation-"));
    const ready = path.join(fixture, "ready");
    const received = path.join(fixture, "received");
    const receiver = path.join(fixture, "receiver.mjs");
    const launcher = path.join(fixture, "launcher.mjs");
    const nativeModule = new URL("native.mjs", import.meta.url).href;
    writeFileSync(
      receiver,
      `import { writeFileSync } from "node:fs"
const received = []
const record = (signal) => {
  received.push(signal)
  writeFileSync(${JSON.stringify(received)}, received.join(","))
  if (signal === "SIGTERM") {
    process.stdout.write(received.join(","))
    process.exit(0)
  }
}
process.on("SIGINT", () => record("SIGINT"))
process.on("SIGTERM", () => record("SIGTERM"))
writeFileSync(${JSON.stringify(ready)}, "ready")
setInterval(() => {}, 1000)
`,
    );
    writeFileSync(
      launcher,
      `import { spawnNative } from ${JSON.stringify(nativeModule)}
const result = await spawnNative([${JSON.stringify(receiver)}], {
  nativeExecutable: process.execPath,
  captureOutput: true,
})
process.stdout.write(result.stdout)
process.exitCode = result.exitCode
`,
    );

    const child = spawn(process.execPath, [launcher], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    context.after(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      rmSync(fixture, { recursive: true, force: true });
    });

    await waitFor(() => existsSync(ready), 5000);
    process.kill(-child.pid, "SIGINT");
    await waitFor(() => readIfExists(received) === "SIGINT", 5000);
    process.kill(-child.pid, "SIGINT");
    await waitFor(() => readIfExists(received) === "SIGINT,SIGINT", 5000);
    process.kill(-child.pid, "SIGTERM");

    const { code, signal } = await waitForExit(child, 5000);
    assert.equal(signal, null);
    assert.equal(code, 0, stderr);
    assert.equal(stdout, "SIGINT,SIGINT,SIGTERM");
  },
);

test(
  "Unix launcher forwards SIGHUP to the complete native process group and then exits",
  { skip: process.platform === "win32" },
  async (context) => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "palamedes-native-hangup-"));
    const launcherReady = path.join(fixture, "launcher-ready");
    const workerReady = path.join(fixture, "worker-ready");
    const workerSignals = path.join(fixture, "worker-signals");
    const worker = path.join(fixture, "worker.mjs");
    const receiver = path.join(fixture, "receiver.mjs");
    const launcher = path.join(fixture, "launcher.mjs");
    const nativeModule = new URL("native.mjs", import.meta.url).href;
    writeFileSync(
      worker,
      `import { writeFileSync } from "node:fs"
let signals = 0
let finish
process.on("SIGHUP", () => {
  signals += 1
  clearTimeout(finish)
  finish = setTimeout(() => {
    writeFileSync(${JSON.stringify(workerSignals)}, String(signals))
    process.exit(0)
  }, 150)
})
writeFileSync(${JSON.stringify(workerReady)}, "ready")
setInterval(() => {}, 1000)
`,
    );
    writeFileSync(
      receiver,
      `import { spawn } from "node:child_process"
import { writeFileSync } from "node:fs"
spawn(process.execPath, [${JSON.stringify(worker)}], { stdio: "ignore" })
writeFileSync(${JSON.stringify(launcherReady)}, "ready")
setInterval(() => {}, 1000)
`,
    );
    writeFileSync(
      launcher,
      `import { spawnNative } from ${JSON.stringify(nativeModule)}
const result = await spawnNative([${JSON.stringify(receiver)}], {
  nativeExecutable: process.execPath,
  captureOutput: true,
})
process.stdout.write(result.stdout)
process.exitCode = result.exitCode
`,
    );

    const child = spawn(process.execPath, [launcher], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    context.after(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      rmSync(fixture, { recursive: true, force: true });
    });

    await waitFor(() => existsSync(launcherReady) && existsSync(workerReady), 5000);
    process.kill(-child.pid, "SIGHUP");
    const { code, signal } = await waitForExit(child, 5000);
    await waitFor(() => existsSync(workerSignals), 5000);
    assert.equal(signal, null);
    assert.equal(code, 129, stderr);
    assert.equal(stdout, "");
    assert.equal(readFileSync(workerSignals, "utf8"), "1");
  },
);

test(
  "Unix launcher termination forwards SIGTERM to the native process group",
  { skip: process.platform === "win32" },
  async (context) => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "palamedes-native-parent-exit-"));
    const ready = path.join(fixture, "native-ready");
    const marker = path.join(fixture, "native-terminated");
    const receiver = path.join(fixture, "receiver.mjs");
    const launcher = path.join(fixture, "launcher.mjs");
    const nativeModule = new URL("native.mjs", import.meta.url).href;
    writeFileSync(
      receiver,
      `import { writeFileSync } from "node:fs"
process.on("SIGTERM", () => {
  writeFileSync(${JSON.stringify(marker)}, "terminated")
  process.exit(0)
})
writeFileSync(${JSON.stringify(ready)}, "ready")
setInterval(() => {}, 1000)
`,
    );
    writeFileSync(
      launcher,
      `import { spawnNative } from ${JSON.stringify(nativeModule)}
import { existsSync } from "node:fs"
void spawnNative([${JSON.stringify(receiver)}], { nativeExecutable: process.execPath })
const timer = setInterval(() => {
  if (existsSync(${JSON.stringify(ready)})) {
    clearInterval(timer)
    process.exit(75)
  }
}, 10)
`,
    );

    const child = spawn(process.execPath, [launcher], {
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    context.after(() => {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      rmSync(fixture, { recursive: true, force: true });
    });

    const { code, signal } = await waitForExit(child, 5000);
    await waitFor(() => existsSync(marker), 5000);
    assert.equal(signal, null);
    assert.equal(code, 75, stderr);
    assert.equal(readFileSync(marker, "utf8"), "terminated");
  },
);

test("native signal listeners are removed after the child exits or fails", async () => {
  const before = signalListenerCounts();
  const exitCode = await spawnNative(["-e", ""], { nativeExecutable: process.execPath });
  assert.equal(exitCode, 0);
  assert.deepEqual(signalListenerCounts(), before);

  await assert.rejects(
    spawnNative([], { nativeExecutable: path.join(os.tmpdir(), "missing-palamedes-native") }),
  );
  assert.deepEqual(signalListenerCounts(), before);
});

test("captured output waits for inherited stdio pipes to close", async () => {
  const workerSource = `setTimeout(() => {
  process.stdout.write("stdout-tail")
  process.stderr.write("stderr-tail")
}, 100)`;
  const parentSource = `
const { spawn } = require("node:child_process")
const worker = spawn(process.execPath, ["-e", ${JSON.stringify(workerSource)}], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
})
worker.unref()
`;

  const result = await spawnNative(["-e", parentSource], {
    nativeExecutable: process.execPath,
    captureOutput: true,
  });

  assert.deepEqual(result, {
    exitCode: 0,
    stdout: "stdout-tail",
    stderr: "stderr-tail",
  });
});

test("captured output settles after a bounded drain when a descendant holds the pipes open", async () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "palamedes-native-open-pipes-"));
  const workerPidFile = path.join(fixture, "worker-pid");
  const workerReadyFile = path.join(fixture, "worker-ready");
  const parentCleanupFile = path.join(fixture, "parent-cleanup");
  const workerSource = `
const { writeFileSync } = require("node:fs")
process.stdout.write("stdout-held-pipe")
process.stderr.write("stderr-held-pipe")
writeFileSync(${JSON.stringify(workerReadyFile)}, "ready")
setInterval(() => {}, 1000)
`;
  const parentSource = `
const { spawn } = require("node:child_process")
const { existsSync, writeFileSync } = require("node:fs")
const worker = spawn(process.execPath, ["-e", ${JSON.stringify(workerSource)}], {
  detached: true,
  stdio: ["ignore", "inherit", "inherit"],
})
writeFileSync(${JSON.stringify(workerPidFile)}, String(worker.pid))
worker.unref()
const readyTimer = setInterval(() => {
  if (existsSync(${JSON.stringify(parentCleanupFile)})) {
    clearInterval(readyTimer)
    process.exit(1)
  }
  if (existsSync(${JSON.stringify(workerReadyFile)})) {
    clearInterval(readyTimer)
    process.exit(0)
  }
}, 10)
`;

  const listenersBefore = signalListenerCounts();
  const spawnPromise = spawnNative(["-e", parentSource], {
    nativeExecutable: process.execPath,
    captureOutput: true,
  });
  const observed = spawnPromise.then(
    () => undefined,
    () => undefined,
  );
  let timeoutId;

  try {
    const startedAt = Date.now();
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error("Timed out waiting for captured output to settle.")),
        5000,
      );
    });
    const result = await Promise.race([spawnPromise, timeoutPromise]);
    const elapsed = Date.now() - startedAt;

    assert.ok(elapsed < 5000, `spawnNative took ${elapsed}ms to settle`);
    assert.doesNotThrow(() => process.kill(Number(readFileSync(workerPidFile, "utf8")), 0));
    assert.deepEqual(signalListenerCounts(), listenersBefore);
    assert.deepEqual(result, {
      exitCode: 0,
      stdout: "stdout-held-pipe",
      stderr: "stderr-held-pipe",
    });
  } finally {
    clearTimeout(timeoutId);
    writeFileSync(parentCleanupFile, "cleanup");
    if (existsSync(workerPidFile)) {
      try {
        process.kill(Number(readFileSync(workerPidFile, "utf8")), "SIGTERM");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    await Promise.race([observed, new Promise((resolve) => setTimeout(resolve, 1000))]);
    rmSync(fixture, { recursive: true, force: true });
  }
});

async function waitFor(predicate, timeout) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for signal fixture readiness.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function waitForExit(child, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for signal fixture exit.")),
      timeout,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

function signalListenerCounts() {
  return Object.fromEntries(
    ["SIGINT", "SIGTERM", "SIGHUP", "exit"].map((signal) => [
      signal,
      process.listenerCount(signal),
    ]),
  );
}

function readIfExists(file) {
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}
