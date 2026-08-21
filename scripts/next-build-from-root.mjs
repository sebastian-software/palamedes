import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const [appDirectory, ...nextArgs] = process.argv.slice(2)

if (!appDirectory) {
  throw new Error(
    "Usage: node scripts/next-build-from-root.mjs <app-directory> [next build options]"
  )
}

const appRoot = resolve(repoRoot, appDirectory)
const nextBin = resolve(appRoot, "node_modules", "next", "dist", "bin", "next")

if (!existsSync(nextBin)) {
  throw new Error(`Could not find the Next CLI for ${appDirectory}: ${nextBin}`)
}

const result = spawnSync(process.execPath, [nextBin, "build", appDirectory, ...nextArgs], {
  cwd: repoRoot,
  stdio: "inherit",
})

process.exitCode = result.status ?? 1
