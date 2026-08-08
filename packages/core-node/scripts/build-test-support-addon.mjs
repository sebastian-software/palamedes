import { execFileSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { copyFile, link, readFile, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

execFileSync("cargo", ["build", "--package", "palamedes-node", "--features", "test-support"], {
  cwd: repoRoot,
  stdio: "inherit",
})

const extension =
  process.platform === "win32" ? "dll" : process.platform === "darwin" ? "dylib" : "so"
const libraryName = `${process.platform === "win32" ? "" : "lib"}palamedes_node.${extension}`
const libraryPath = path.join(repoRoot, "target", "debug", libraryName)
const library = await readFile(libraryPath)
const digest = createHash("sha256").update(library).digest("hex").slice(0, 16)
const addonPath = path.join(
  repoRoot,
  "target",
  "debug",
  `palamedes-node-test-support-${digest}.node`
)

const temporaryAddonPath = `${addonPath}.${process.pid}.${randomUUID()}.tmp`

try {
  await copyFile(libraryPath, temporaryAddonPath)
  if (process.platform === "darwin") {
    execFileSync("codesign", ["--force", "--sign", "-", "--timestamp=none", temporaryAddonPath], {
      stdio: "inherit",
    })
  }
  try {
    // Linking is exclusive and atomic. The content-addressed addon is never
    // overwritten, so an already loaded Windows DLL remains untouched.
    await link(temporaryAddonPath, addonPath)
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") {
      throw error
    }
  }
} finally {
  await rm(temporaryAddonPath, { force: true })
}
