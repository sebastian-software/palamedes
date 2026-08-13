import { readdir, readFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = join(fileURLToPath(new URL("..", import.meta.url)))
const siteAppRoot = join(repoRoot, "site/app")
const siteUiStyles = join(repoRoot, "packages/site-ui/styles.css")

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map(async (entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return sourceFiles(path)
        return /\.(?:ts|tsx|css)$/u.test(entry.name) ? [path] : []
      })
    )
  ).flat()
}

const offenders = []
for (const file of await sourceFiles(siteAppRoot)) {
  const source = await readFile(file, "utf8")
  if (/\bborder-l-4\b/u.test(source)) offenders.push(relative(repoRoot, file))
}

if (offenders.length > 0) {
  throw new Error(`Thick editorial side tabs are not allowed: ${offenders.join(", ")}`)
}

const styles = await readFile(siteUiStyles, "utf8")
if (!styles.includes(".pmds-editorial-rail") || !styles.includes("border-inline-start: 1px")) {
  throw new Error("EditorialRail must retain its one-pixel shared rail")
}

console.log("verify-site-editorial-rails: shared one-pixel editorial rails enforced")
