import { spawn } from "node:child_process"

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
    child.stdout?.setEncoding("utf8")
    child.stderr?.setEncoding("utf8")
    child.stdout?.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr?.on("data", (chunk) => {
      stderr += chunk
    })
    const forwardSignal = (signal) => {
      try {
        if (isolatedSignalGroup && child.pid) {
          process.kill(-child.pid, signal)
        } else {
          child.kill(signal)
        }
      } catch (error) {
        if (error?.code !== "ESRCH") throw error
      }
    }
    const onAbort = () => forwardSignal(options.signal?.reason?.signal ?? "SIGTERM")
    // Forward direct and terminal signals to the isolated native process group
    // so killing the launcher never orphans native subprocesses.
    const forwardInterrupt = () => forwardSignal("SIGINT")
    const forwardTerminate = () => forwardSignal("SIGTERM")
    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort)
      process.off("SIGINT", forwardInterrupt)
      process.off("SIGTERM", forwardTerminate)
    }
    options.signal?.addEventListener("abort", onAbort, { once: true })
    process.on("SIGINT", forwardInterrupt)
    process.on("SIGTERM", forwardTerminate)
    if (options.signal?.aborted) onAbort()
    child.once("error", (error) => {
      cleanup()
      reject(error)
    })
    child.once("exit", (code, signal) => {
      cleanup()
      const exitCode = signal
        ? signal === "SIGINT"
          ? 130
          : signal === "SIGTERM"
            ? 143
            : 1
        : (code ?? 1)
      resolve(captureOutput ? { exitCode, stdout, stderr } : exitCode)
    })
  })
}

function abortExitCode(reason) {
  if (Number.isInteger(reason?.exitCode)) return reason.exitCode
  return reason?.signal === "SIGTERM" ? 143 : 130
}
