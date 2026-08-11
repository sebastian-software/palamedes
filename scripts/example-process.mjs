import { execFileSync, spawn } from "node:child_process"
import { ROOT } from "./example-matrix.mjs"

export function startCommand({ args, cwd, env }) {
  return spawn("pnpm", args, {
    cwd,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      ...env,
    },
    stdio: "inherit",
  })
}

export function getListeningPids(port) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })

    return output
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value))
  } catch {
    return []
  }
}

export async function ensurePortFree(port) {
  const pids = getListeningPids(port)

  if (pids.length === 0) {
    return
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM")
    } catch {}
  }

  const startedAt = Date.now()
  while (Date.now() - startedAt < 2000) {
    if (getListeningPids(port).length === 0) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  for (const pid of getListeningPids(port)) {
    try {
      process.kill(pid, "SIGKILL")
    } catch {}
  }
}

export function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", () => resolve())
  })
}

export async function stopCommand(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  try {
    if (process.platform === "win32") {
      child.kill("SIGTERM")
    } else {
      process.kill(-child.pid, "SIGTERM")
    }
  } catch {}

  const exitPromise = waitForExit(child)
  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 2000))
  await Promise.race([exitPromise, timeoutPromise])

  if (child.exitCode !== null || child.signalCode !== null) {
    return
  }

  try {
    if (process.platform === "win32") {
      child.kill("SIGKILL")
    } else {
      process.kill(-child.pid, "SIGKILL")
    }
  } catch {}

  await waitForExit(child)
}

export function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, ...args], {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
    })

    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${scriptPath} failed with exit code ${code}`))
      }
    })

    child.on("error", reject)
  })
}
