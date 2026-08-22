import { existsSync, readFileSync } from "node:fs"
import { dirname, join, normalize, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const README = "README.md"
const GITHUB_BLOB_PREFIX = "https://github.com/sebastian-software/palamedes/blob/main/"

function fail(message) {
  throw new Error(`README information architecture: ${message}`)
}

function headingSlug(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s-]/gu, "")
    .replaceAll(/\s+/gu, "-")
    .replaceAll(/-+/gu, "-")
}

function secondLevelSections(markdown) {
  const headings = [...markdown.matchAll(/^## (.+)$/gmu)]
  return headings.map((match, index) => ({
    heading: match[1],
    index: match.index,
    body: markdown.slice(
      match.index + match[0].length,
      headings[index + 1]?.index ?? markdown.length
    ),
  }))
}

function markdownLinks(markdown) {
  return [...markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)].map(
    ([, target]) => target
  )
}

function headingAnchors(markdown) {
  return new Set(
    [...markdown.matchAll(/^#{1,6} (.+)$/gmu)].map(([, heading]) => headingSlug(heading))
  )
}

function localTarget(target) {
  if (target.startsWith(GITHUB_BLOB_PREFIX)) {
    return target.slice(GITHUB_BLOB_PREFIX.length)
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(target) || target.startsWith("//")) return null
  return target
}

export function checkReadmeInformationArchitecture({ read, exists }) {
  const markdown = read(README)
  const sections = secondLevelSections(markdown)
  const byHeading = new Map()

  for (const section of sections) {
    if (byHeading.has(section.heading)) fail(`duplicate heading "${section.heading}"`)
    byHeading.set(section.heading, section)
  }

  const start = byHeading.get("Start Here")
  const proof = byHeading.get("Proof You Can Inspect")
  const detailedQuickstart = byHeading.get("Quick Start With Vite")
  if (!start || !proof || !detailedQuickstart) {
    fail("missing Start Here, Proof You Can Inspect, or Quick Start With Vite")
  }
  if (start.index >= proof.index || proof.index >= detailedQuickstart.index) {
    fail("Start Here must precede proof, which must precede the detailed Vite quickstart")
  }

  const installCommands = [
    "pnpm add @palamedes/core @palamedes/runtime @palamedes/vite-plugin",
    "pnpm add -D @palamedes/cli",
  ]
  const startLines = new Set(start.body.split(/\r?\n/u))
  const detailedLines = new Set(detailedQuickstart.body.split(/\r?\n/u))
  for (const command of installCommands) {
    if (!startLines.has(command)) fail(`Start Here is missing copyable command: ${command}`)
    if (!detailedLines.has(command)) {
      fail(`the detailed Vite quickstart drifted from Start Here: ${command}`)
    }
  }
  if (!start.body.includes("[5-minute quickstart](docs/first-working-translation.md)")) {
    fail("Start Here must link to the canonical 5-minute quickstart")
  }
  if (!start.body.includes("[Skip to the proof](#proof-you-can-inspect)")) {
    fail("Start Here must offer evaluators a direct proof path")
  }

  for (const target of markdownLinks(markdown)) {
    const local = localTarget(target)
    if (local === null) continue
    const [path, fragment] = local.split("#", 2)
    if (!path) {
      if (fragment && !headingAnchors(markdown).has(fragment)) {
        fail(`link points to missing anchor: ${target}`)
      }
      continue
    }

    const resolved = normalize(resolve(root, decodeURIComponent(path)))
    const outsideRoot = relative(root, resolved).startsWith("..")
    if (outsideRoot || !exists(resolved)) fail(`link points to missing repository path: ${target}`)
    if (fragment && !headingAnchors(read(path)).has(fragment)) {
      fail(`link points to missing anchor: ${target}`)
    }
  }
}

export function checkCheckedInReadme() {
  checkReadmeInformationArchitecture({
    read: (file) => readFileSync(join(root, file), "utf8"),
    exists: existsSync,
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    checkCheckedInReadme()
    console.log("check-readme-ia: README ordering, quickstart, links, and anchors are valid")
  } catch (error) {
    console.error(`check-readme-ia: ${error.message}`)
    process.exitCode = 1
  }
}
