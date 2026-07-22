import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const packageDir = path.resolve(import.meta.dirname, "..")
const binDir = path.join(packageDir, "bin")

mkdirSync(binDir, { recursive: true })
rmSync(path.join(binDir, "pmds-native"), { force: true })
rmSync(path.join(binDir, "pmds-native.exe"), { force: true })
const wrapperPath = path.join(binDir, "pmds")
writeFileSync(wrapperPath, wrapperScript())
chmodSync(wrapperPath, 0o755)
console.log("@palamedes/cli ships platform binaries through optional packages.")

function wrapperScript() {
  return `#!/usr/bin/env node
import { runCli } from "../scripts/run.mjs"

process.exitCode = await runCli(process.argv.slice(2))
`
}
