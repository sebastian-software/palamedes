import path from "node:path"
import { spawn } from "node:child_process"

/*
 * Shared by the measured runs in run.mjs and by corpus generation, which has to
 * invoke the General Translation CLI once per profile to learn the message
 * hashes it will key its catalogs by.
 */
export async function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env,
      },
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
    child.on("error", reject)
    child.on("close", (code, signal) => {
      if (code !== 0) {
        reject(
          new Error(
            `${path.basename(command)} ${args.join(" ")} failed with ${signal ?? code}\n${stdout}\n${stderr}`
          )
        )
        return
      }
      resolve({ stdout, stderr })
    })
  })
}
