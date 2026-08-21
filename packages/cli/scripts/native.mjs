import { spawn } from "node:child_process"
import { constants } from "node:os"

export async function spawnNative(args, options = {}) {
  const executable = options.nativeExecutable
  if (!executable) {
    throw new Error("Palamedes native CLI executable is not configured.")
  }
  if (options.signal?.aborted) {
    return abortExitCode(options.signal.reason)
  }

  return new Promise((resolve, reject) => {
    const captureOutput = options.captureOutput === true
    const isolatedSignalGroup = process.platform !== "win32"
    const child = spawn(executable, args, {
      cwd: options.cwd,
      stdio: captureOutput ? ["inherit", "pipe", "pipe"] : "inherit",
      // On Unix the native CLI becomes its own process-group leader. Terminal
      // signals reach this launcher once and are forwarded to that group once,
      // instead of reaching the child directly and then being duplicated.
      detached: isolatedSignalGroup,
    })
    let stdout = ""
    let stderr = ""
    let settled = false
    let terminationForwarded = false
    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk
    })
    const forwardSignal = (signal) => {
      if (settled || terminationForwarded) return false
      terminationForwarded = true
      try {
        if (isolatedSignalGroup && child.pid) {
          process.kill(-child.pid, signal)
        } else {
          child.kill(signal)
        }
      } catch (error) {
        if (error?.code !== "ESRCH") throw error
      }
      return true
    }
    const onAbort = () => forwardSignal(options.signal?.reason?.signal ?? "SIGTERM")
    // Forward direct and terminal signals to the isolated native process group
    // so killing the launcher never orphans native subprocesses.
    const forwardInterrupt = () => forwardSignal("SIGINT")
    const forwardTerminate = () => forwardSignal("SIGTERM")
    // A terminal hangup reaches the npm launcher but not its detached native
    // process group. Keep the launcher alive until the native process has
    // handled that hangup and exited.
    const forwardHangup = () => forwardSignal("SIGHUP")
    // `process.exit()` and uncaught failures still run this synchronous hook.
    // SIGKILL cannot be intercepted; a native parent-death mechanism would be
    // platform-specific and belongs outside this JavaScript wrapper.
    const onParentExit = () => forwardSignal("SIGTERM")
    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort)
      process.off("SIGINT", forwardInterrupt)
      process.off("SIGTERM", forwardTerminate)
      if (isolatedSignalGroup) process.off("SIGHUP", forwardHangup)
      process.off("exit", onParentExit)
    }
    const settle = (callback) => {
      if (settled) return
      settled = true
      cleanup()
      callback()
    }

    child.once("error", (error) => settle(() => reject(error)))
    child.once("exit", (code, signal) => {
      settle(() => {
        const exitCode = signal ? signalExitCode(signal) : (code ?? 1)
        resolve(captureOutput ? { exitCode, stdout, stderr } : exitCode)
      })
    })

    options.signal?.addEventListener("abort", onAbort, { once: true })
    process.on("SIGINT", forwardInterrupt)
    process.on("SIGTERM", forwardTerminate)
    if (isolatedSignalGroup) process.on("SIGHUP", forwardHangup)
    process.once("exit", onParentExit)
    if (options.signal?.aborted) onAbort()
  })
}

function signalExitCode(signal) {
  const signalNumber = constants.signals[signal]
  return Number.isInteger(signalNumber) ? 128 + signalNumber : 1
}

function abortExitCode(reason) {
  if (Number.isInteger(reason?.exitCode)) return reason.exitCode
  return reason?.signal === "SIGTERM" ? 143 : 130
}
