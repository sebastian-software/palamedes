import { execFileSync, spawn } from "node:child_process"
import http from "node:http"
import { parseExampleArgs, selectExamples } from "./example-matrix.mjs"

function runCommand({ args, cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn("pnpm", args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: "inherit",
    })

    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`pnpm ${args.join(" ")} failed in ${cwd} with exit code ${code}`))
      }
    })
  })
}

function startCommand({ args, cwd, env }) {
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

function getListeningPids(port) {
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

async function ensurePortFree(port) {
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
  while (Date.now() - startedAt < 2_000) {
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

function waitForExit(child) {
  return new Promise((resolve) => {
    child.once("exit", () => resolve())
  })
}

async function stopCommand(child) {
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
  const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 2_000))
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

function requestText(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        headers,
        host: "127.0.0.1",
        method: "GET",
        path: requestPath,
        port,
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            headers: response.headers,
            statusCode: response.statusCode ?? 0,
          })
        })
      },
    )

    request.on("error", reject)
    request.end()
  })
}

async function waitForServer(port, pathToCheck = "/") {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await requestText(port, pathToCheck)
      if (response.statusCode >= 200) {
        return
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 300))
  }

  throw new Error(`Timed out waiting for server on port ${port}`)
}

async function verifyExample(example) {
  await ensurePortFree(example.port)
  await runCommand({
    args: example.build,
    cwd: example.cwd,
    env: example.buildEnv,
  })

  const child = startCommand({
    args: example.start,
    cwd: example.cwd,
    env: example.startEnv,
  })

  try {
    await waitForServer(example.port, example.strategy === "route" ? "/en" : "/")

    for (const check of example.smokeChecks) {
      const response = await requestText(example.port, check.path, check.headers)
      for (const substring of check.substrings) {
        if (!response.body.includes(substring)) {
          throw new Error(`Missing substring "${substring}" in ${example.id} response for ${check.path}`)
        }
      }
    }
  } finally {
    await stopCommand(child)
    await ensurePortFree(example.port)
  }
}

async function main() {
  const selected = selectExamples(parseExampleArgs(process.argv))

  if (selected.length === 0) {
    throw new Error("No examples matched the provided filters")
  }

  for (const example of selected) {
    console.log(`\n[verify:smoke] ${example.id} on port ${example.port}`)
    await verifyExample(example)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
