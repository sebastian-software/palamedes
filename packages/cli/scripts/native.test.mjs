import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"

test(
  "one Unix launcher group signal reaches the native child exactly once",
  { skip: process.platform === "win32" },
  async (context) => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "palamedes-native-signal-"))
    const marker = path.join(fixture, "ready")
    const receiver = path.join(fixture, "receiver.mjs")
    const launcher = path.join(fixture, "launcher.mjs")
    const nativeModule = new URL("native.mjs", import.meta.url).href
    writeFileSync(
      receiver,
      `import { writeFileSync } from "node:fs"
writeFileSync(${JSON.stringify(marker)}, "ready")
let signals = 0
let finish
process.on("SIGINT", () => {
  signals += 1
  clearTimeout(finish)
  finish = setTimeout(() => {
    process.stdout.write(String(signals))
    process.exit(0)
  }, 150)
})
setInterval(() => {}, 1000)
`
    )
    writeFileSync(
      launcher,
      `import { spawnNative } from ${JSON.stringify(nativeModule)}
const result = await spawnNative([${JSON.stringify(receiver)}], {
  nativeExecutable: process.execPath,
  captureOutput: true,
})
process.stdout.write(result.stdout)
process.exitCode = result.exitCode
`
    )

    const child = spawn(process.execPath, [launcher], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })

    context.after(() => {
      try {
        process.kill(-child.pid, "SIGKILL")
      } catch (error) {
        if (error?.code !== "ESRCH") throw error
      }
      rmSync(fixture, { recursive: true, force: true })
    })

    await waitFor(() => existsSync(marker), 5000)
    process.kill(-child.pid, "SIGINT")
    const { code, signal } = await waitForExit(child, 5000)
    assert.equal(signal, null)
    assert.equal(code, 0, stderr)
    assert.equal(stdout, "1")
  }
)

async function waitFor(predicate, timeout) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for signal fixture readiness.")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function waitForExit(child, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for signal fixture exit.")),
      timeout
    )
    child.once("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal })
    })
  })
}
