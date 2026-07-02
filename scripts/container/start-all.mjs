#!/usr/bin/env node
// Container supervisor: start every example app from the shared EXAMPLE_MATRIX on
// its fixed port, bound to 0.0.0.0, and supervise them side by side. The image
// build already ran `pnpm build` + `pnpm build:examples`; this script only runs
// the production start scripts at container runtime.
//
// Run with an init process (e.g. `podman run --init`) so reparented grandchild
// processes are reaped correctly when Node runs as PID 1.

import { spawn } from "node:child_process"
import process from "node:process"
import { EXAMPLE_MATRIX } from "../example-matrix.mjs"
import { buildStartArgs, buildStartEnv } from "./start-plan.mjs"

const FORCE_KILL_TIMEOUT_MS = 5000
const children = []
let shuttingDown = false

function log(message) {
  process.stdout.write(`[supervisor] ${message}\n`)
}

// Prefix each child line with its example id so the interleaved output of ten
// servers stays readable.
function prefixOutput(stream, id) {
  const tag = `[${id}] `
  let buffer = ""
  stream.setEncoding("utf8")
  stream.on("data", (chunk) => {
    buffer += chunk
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""
    for (const line of lines) {
      process.stdout.write(`${tag}${line}\n`)
    }
  })
  stream.on("end", () => {
    if (buffer.length > 0) {
      process.stdout.write(`${tag}${buffer}\n`)
    }
  })
}

function startExample(example) {
  const child = spawn("pnpm", buildStartArgs(example), {
    cwd: example.cwd,
    detached: true,
    env: buildStartEnv(example, process.env),
    stdio: ["ignore", "pipe", "pipe"],
  })

  prefixOutput(child.stdout, example.id)
  prefixOutput(child.stderr, example.id)
  return child
}

function terminateGroup(child, signal) {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return
  }
  try {
    // Negative pid targets the whole detached process group (pnpm + the server).
    process.kill(-child.pid, signal)
  } catch {
    // The process group is already gone; nothing left to terminate.
  }
}

function allStopped() {
  return children.every(({ child }) => child.exitCode !== null || child.signalCode !== null)
}

// Fail-fast shutdown: terminate every server, escalate to SIGKILL after a
// timeout, then exit once all have stopped.
function shutdown(reason, exitCode) {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  log(`shutting down (${reason})`)

  for (const { child } of children) {
    terminateGroup(child, "SIGTERM")
  }

  const forceTimer = setTimeout(() => {
    for (const { child } of children) {
      terminateGroup(child, "SIGKILL")
    }
  }, FORCE_KILL_TIMEOUT_MS)
  forceTimer.unref()

  const poll = setInterval(() => {
    if (allStopped()) {
      clearInterval(poll)
      clearTimeout(forceTimer)
      // Set the exit code and let the event loop drain so buffered stdout (incl.
      // the crash reason) flushes; a short backstop guarantees the process exits.
      process.exitCode = exitCode
      setTimeout(() => process.exit(exitCode), 200).unref()
    }
  }, 100)
  poll.unref()
}

function main() {
  log(`starting ${EXAMPLE_MATRIX.length} example servers`)

  for (const example of EXAMPLE_MATRIX) {
    const child = startExample(example)
    children.push({ child, example })
    log(`started ${example.id} on port ${example.port} (pid ${child.pid ?? "unknown"})`)

    child.on("exit", (code, signal) => {
      if (shuttingDown) {
        return
      }
      log(`${example.id} exited unexpectedly (code ${code}, signal ${signal})`)
      shutdown(`${example.id} exited`, 1)
    })

    child.on("error", (error) => {
      if (shuttingDown) {
        return
      }
      log(`failed to start ${example.id}: ${error.message}`)
      shutdown(`${example.id} error`, 1)
    })
  }

  process.on("SIGTERM", () => shutdown("SIGTERM", 0))
  process.on("SIGINT", () => shutdown("SIGINT", 0))
}

main()
