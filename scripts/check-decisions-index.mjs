import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { pathToFileURL } from "node:url"

function decisionEntries(index) {
  return [...index.matchAll(/^\d+\. \[(ADR-\d{3}: .+)\]\(\.\/(adr\/[^)]+\.md)\)$/gmu)].map(
    ([, title, file]) => ({ file, title })
  )
}

function adrTitle(source, file) {
  const heading = source.match(/^# (ADR-\d{3}: .+)$/mu)
  if (!heading) throw new Error(`${file} must start with a canonical ADR title`)
  return heading[1]
}

export function checkDecisionsIndex({ read, listDirectories } = {}) {
  const readFile = read ?? ((file) => readFileSync(path.join(process.cwd(), file), "utf8"))
  const list = listDirectories ?? ((directory) => readdirSync(path.join(process.cwd(), directory)))
  const adrFiles = list("adr")
    .filter((file) => file.endsWith(".md"))
    .map((file) => `adr/${file}`)
    .sort()
  const entries = decisionEntries(readFile("DECISIONS.md"))
  const indexedFiles = entries.map(({ file }) => file).sort()

  if (entries.length !== adrFiles.length) {
    throw new Error(
      `DECISIONS.md indexes ${entries.length} ADRs, but adr/ contains ${adrFiles.length}`
    )
  }
  if (new Set(indexedFiles).size !== indexedFiles.length) {
    throw new Error("DECISIONS.md must link to each ADR exactly once")
  }
  if (indexedFiles.join("\n") !== adrFiles.join("\n")) {
    throw new Error("DECISIONS.md ADR links must match the files in adr/")
  }

  for (const { file, title } of entries) {
    const canonicalTitle = adrTitle(readFile(file), file)
    if (title !== canonicalTitle) {
      throw new Error(`DECISIONS.md title for ${file} must match its ADR heading`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    checkDecisionsIndex()
    console.log("DECISIONS.md matches the canonical ADR set.")
  } catch (error) {
    console.error(`check-decisions-index: ${error.message}`)
    process.exitCode = 1
  }
}
