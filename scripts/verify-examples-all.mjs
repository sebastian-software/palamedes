import { spawn } from "node:child_process"
import { ROOT } from "./example-matrix.mjs"

function runNodeScript(scriptPath, args) {
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
  })
}

async function main() {
  const args = process.argv.slice(2)
  await runNodeScript("./scripts/verify-examples.mjs", args)
  await runNodeScript("./scripts/verify-examples-browser.mjs", args)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
