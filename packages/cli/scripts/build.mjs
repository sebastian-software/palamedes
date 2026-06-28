import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"

const packageDir = path.resolve(import.meta.dirname, "..")
const binDir = path.join(packageDir, "bin")

mkdirSync(binDir, { recursive: true })
rmSync(path.join(binDir, "pmds.exe"), { force: true })
writeFileSync(
  path.join(binDir, "pmds"),
  "#!/bin/sh\nprintf '%s\\n' 'Palamedes CLI native binary was not installed for this platform.' >&2\nexit 1\n"
)
console.log("@palamedes/cli ships platform binaries through optional packages.")
