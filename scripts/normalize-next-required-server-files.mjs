import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"

async function main() {
  const manifestPath = path.resolve(process.cwd(), ".next", "required-server-files.json")
  const raw = await readFile(manifestPath, "utf8")
  const manifest = JSON.parse(raw)

  if (manifest && typeof manifest === "object" && "relativeAppDir" in manifest) {
    delete manifest.relativeAppDir
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    console.log(`[next-normalize] removed relativeAppDir from ${manifestPath}`)
  } else {
    console.log(`[next-normalize] no relativeAppDir in ${manifestPath}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
