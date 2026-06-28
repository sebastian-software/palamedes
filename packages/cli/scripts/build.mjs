import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const packageDir = path.resolve(import.meta.dirname, "..")
const binDir = path.join(packageDir, "bin")

mkdirSync(binDir, { recursive: true })
rmSync(path.join(binDir, "pmds.exe"), { force: true })
writeFileSync(path.join(binDir, "pmds"), fallbackScript())
console.log("@palamedes/cli ships platform binaries through optional packages.")

function fallbackScript() {
  return `#!/usr/bin/env node
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const binDir = path.dirname(fileURLToPath(import.meta.url))
const executable = path.join(binDir, "pmds.exe")

if (process.platform === "win32" && existsSync(executable)) {
  const result = spawnSync(executable, process.argv.slice(2), { stdio: "inherit" })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  if (result.signal) {
    console.error(\`pmds exited with signal \${result.signal}\`)
    process.exit(1)
  }
  process.exit(result.status ?? 0)
}

console.error("Palamedes CLI native binary was not installed for this platform.")
process.exit(1)
`
}
