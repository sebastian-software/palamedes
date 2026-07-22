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
    const child = spawn(executable, args, {
      cwd: options.cwd,
      stdio: captureOutput ? ["inherit", "pipe", "pipe"] : "inherit",
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
    const onAbort = () => child.kill(options.signal?.reason?.signal ?? "SIGTERM")
    const cleanup = () => options.signal?.removeEventListener("abort", onAbort)
    options.signal?.addEventListener("abort", onAbort, { once: true })
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
