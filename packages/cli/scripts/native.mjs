import { spawn } from "node:child_process"

export async function spawnNative(args, options = {}) {
  const executable = options.nativeExecutable
  if (!executable) {
    throw new Error("Palamedes native CLI executable is not configured.")
  }

  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      stdio: "inherit",
    })
    const onAbort = () => child.kill(options.signal?.reason?.signal ?? "SIGTERM")
    options.signal?.addEventListener("abort", onAbort, { once: true })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      options.signal?.removeEventListener("abort", onAbort)
      if (signal) {
        resolve(signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 1)
      } else {
        resolve(code ?? 1)
      }
    })
  })
}
