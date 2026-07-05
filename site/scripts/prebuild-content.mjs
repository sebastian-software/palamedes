import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { dirname, extname, join, posix, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { generateApiDocs } from "ardo/typedoc"

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = resolve(siteRoot, "..")
const routesRoot = join(siteRoot, "app/routes")
const publicRoot = join(siteRoot, "public")
const repoUrl = "https://github.com/sebastian-software/palamedes"
const pendingAssetCopies = []

const generatedDirs = [
  join(routesRoot, "api-reference"),
  join(routesRoot, "decisions"),
  join(routesRoot, "docs"),
]

for (const dir of generatedDirs) {
  await rm(dir, { recursive: true, force: true })
}
await rm(join(routesRoot, "blog"), { recursive: true, force: true })
await rm(join(publicRoot, "docs"), { recursive: true, force: true })

const docs = await collectDocs()
const posts = await collectPosts()
const adrs = await collectAdrs()
const hostedRoutes = new Map()

for (const doc of docs) hostedRoutes.set(doc.source, doc.route)
for (const post of posts) hostedRoutes.set(post.source, post.route)
for (const adr of adrs) hostedRoutes.set(adr.source, adr.route)
hostedRoutes.set("DECISIONS.md", "/decisions")

await writeDocsIndex(docs)
for (const doc of docs) {
  await writeRouteFromSource(doc)
}

await writeDecisionsIndex(adrs)
for (const adr of adrs) {
  await writeRouteFromSource(adr)
}

for (const post of posts) {
  await writeRouteFromSource(post)
}

await writeApiReferenceIndex()
await generateTypedocReference()
await normalizeTypedocModuleLinks()
await ensureDirectoryIndexes(join(routesRoot, "api-reference"))

console.log(
  `prebuild-content: generated ${docs.length} docs, ${adrs.length} ADRs, ${posts.length} posts, and TypeDoc API routes`
)

async function collectDocs() {
  const entries = []
  const topLevel = await readMarkdownFiles("docs")
  const excludedTopLevel = new Set(["founder-led-content.md"])
  const order = new Map([
    ["first-working-translation.md", 10],
    ["configuration.md", 20],
    ["cli.md", 30],
    ["catalog-formats.md", 40],
    ["locale-strategies.md", 50],
    ["backend-servers.md", 60],
    ["migrate-from-lingui.md", 70],
    ["comparison-with-lingui.md", 80],
    ["approach-comparison.md", 90],
    ["proof-and-benchmarks.md", 100],
    ["benchmark-e2e-workflow.md", 110],
    ["benchmark-lingui-v6-preview.md", 120],
    ["stability.md", 130],
    ["principles.md", 140],
    ["pseudo-localization.md", 150],
    ["troubleshooting.md", 160],
  ])

  for (const fileName of topLevel) {
    if (excludedTopLevel.has(fileName)) continue
    entries.push({
      source: `docs/${fileName}`,
      route: `/docs/${stripMarkdownExtension(fileName)}`,
      out: join(routesRoot, "docs", fileName),
      order: order.get(fileName) ?? 500,
    })
  }

  await collectNestedDocs(entries, "docs/api", "/docs/api", 200)
  await collectNestedDocs(entries, "docs/example-screenshots", "/docs/example-screenshots", 300)
  await collectNestedDocs(entries, "docs/migrations", "/docs/migrations", 400)
  await collectNestedDocs(entries, "docs/operations", "/docs/operations", 450)

  return entries.sort(
    (left, right) => left.order - right.order || left.source.localeCompare(right.source)
  )
}

async function collectNestedDocs(entries, sourceDir, routePrefix, orderBase) {
  const files = await readMarkdownFiles(sourceDir)
  let offset = 0
  for (const fileName of files) {
    const source = `${sourceDir}/${fileName}`
    const routeName = fileName === "README.md" ? "index" : stripMarkdownExtension(fileName)
    const route = fileName === "README.md" ? routePrefix : `${routePrefix}/${routeName}`
    const out = join(routesRoot, routeToFilePath(route))
    entries.push({ source, route, out, order: orderBase + offset })
    offset += 10
  }
}

async function collectPosts() {
  const sourceDir = "docs/site/posts"
  const files = (await readMarkdownFiles(sourceDir)).filter((fileName) => fileName !== "README.md")
  const dates = new Map([
    ["the-third-time-i-built-javascript-i18n-tooling.md", "2026-07-05"],
    ["a-calmer-path-for-javascript-i18n.md", "2026-07-05"],
    ["measuring-palamedes-honestly.md", "2026-07-05"],
    ["browser-verifying-i18n-across-five-frameworks.md", "2026-07-05"],
    ["micro-content-round-1.md", "2026-07-05"],
    ["what-we-delegated-to-ferrocat-and-why.md", "2026-07-05"],
    ["from-lingui-to-palamedes.md", "2026-07-05"],
  ])

  return files.map((fileName, index) => ({
    source: `${sourceDir}/${fileName}`,
    route: `/blog/${stripMarkdownExtension(fileName)}`,
    out: join(routesRoot, "blog", fileName),
    order: (index + 1) * 10,
    date: dates.get(fileName),
  }))
}

async function collectAdrs() {
  const files = await readMarkdownFiles("adr")
  return files.map((fileName, index) => ({
    source: `adr/${fileName}`,
    route: `/decisions/${stripMarkdownExtension(fileName)}`,
    out: join(routesRoot, "decisions", fileName),
    order: (index + 1) * 10,
  }))
}

async function readMarkdownFiles(sourceDir) {
  const dir = join(repoRoot, sourceDir)
  const entries = await readdir(dir, { withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right))
}

async function writeDocsIndex(docs) {
  const guides = docs.filter(
    (doc) => doc.source.startsWith("docs/") && !doc.source.startsWith("docs/api/")
  )
  const lines = [
    "---",
    'title: "Documentation"',
    'description: "Guides, references, operations notes, and migration material for Palamedes."',
    "order: 0",
    "---",
    "",
    "# Documentation",
    "",
    "Canonical source files still live under `docs/`; this site renders them as searchable ARDO routes.",
    "",
    ...guides.map((doc) => `- [${doc.title ?? titleFromPath(doc.source)}](${doc.route})`),
    "",
  ]
  await writeGeneratedFile(join(routesRoot, "docs/index.md"), lines.join("\n"))
}

async function writeDecisionsIndex(adrs) {
  const lines = [
    "---",
    'title: "Architecture Decisions"',
    'description: "Generated index of the Palamedes architecture decision records."',
    "order: 0",
    "---",
    "",
    "# Architecture Decisions",
    "",
    "The ADR files remain canonical in `adr/`. This index is generated from the current filenames during the site prebuild.",
    "",
  ]

  for (const adr of adrs) {
    const content = await readRepoFile(adr.source)
    const title = extractTitle(content) ?? titleFromPath(adr.source)
    lines.push(`- [${title}](${adr.route})`)
  }
  lines.push("")
  await writeGeneratedFile(join(routesRoot, "decisions/index.md"), lines.join("\n"))
}

async function writeApiReferenceIndex() {
  const packages = typedocPackages()
  const lines = [
    "---",
    'title: "Generated API Reference"',
    'description: "TypeDoc-generated reference pages for the public Palamedes TypeScript packages."',
    "order: 0",
    "---",
    "",
    "# Generated API Reference",
    "",
    "These pages complement the curated guide-style API notes under [Docs API](/docs/api). They are generated from package source during the site prebuild and link back to the repository.",
    "",
    ...packages.map((pkg) => `- [${pkg.label}](/api-reference/${pkg.slug})`),
    "",
  ]
  await writeGeneratedFile(join(routesRoot, "api-reference/index.md"), lines.join("\n"))
}

async function writeRouteFromSource(entry) {
  const raw = await readRepoFile(entry.source)
  const parsed = stripExistingFrontmatter(raw)
  const title = extractTitle(parsed.content) ?? titleFromPath(entry.source)
  const description = firstParagraph(parsed.content)
  const status = extractAdrMeta(parsed.content, "Status")
  const date = entry.date ?? extractAdrMeta(parsed.content, "Date")
  const content = transformLinks(parsed.content, entry.source)
  const frontmatter = {
    title,
    description,
    order: entry.order,
    ...(date ? { date } : {}),
    ...(status ? { status } : {}),
  }
  entry.title = title
  await writeGeneratedFile(entry.out, `${toFrontmatter(frontmatter)}\n${content.trim()}\n`)
}

async function generateTypedocReference() {
  for (const pkg of typedocPackages()) {
    await generateApiDocs(
      {
        enabled: true,
        entryPoints: pkg.entryPoints.map((entry) => join(repoRoot, entry)),
        tsconfig: join(siteRoot, "tsconfig.typedoc.json"),
        out: `api-reference/${pkg.slug}`,
        excludePrivate: true,
        excludeProtected: true,
        excludeInternal: true,
        markdown: {
          sourceLinks: true,
          sourceBaseUrl: "https://github.com/sebastian-software/palamedes/blob/main/",
        },
        sidebar: {
          title: pkg.label,
          collapsed: true,
          position: pkg.position,
        },
      },
      routesRoot
    )
  }
}

async function ensureDirectoryIndexes(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true })
  let hasMarkdownChild = false

  for (const entry of entries) {
    const childPath = join(rootDir, entry.name)
    if (entry.isDirectory()) {
      const childHasMarkdown = await ensureDirectoryIndexes(childPath)
      hasMarkdownChild ||= childHasMarkdown
      continue
    }

    if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md") {
      hasMarkdownChild = true
    }
  }

  const indexPath = join(rootDir, "index.md")
  if (hasMarkdownChild && !existsSync(indexPath)) {
    const relativeDir = relativeRouteDir(rootDir)
    const title = titleFromPath(relativeDir)
    await writeGeneratedFile(
      indexPath,
      [
        "---",
        `title: ${JSON.stringify(title)}`,
        `description: ${JSON.stringify(`Generated API reference section for ${title}.`)}`,
        "sidebar: leaf",
        "---",
        "",
        `# ${title}`,
        "",
        "This generated TypeDoc section groups the pages below.",
        "",
      ].join("\n")
    )
  }

  return hasMarkdownChild || existsSync(indexPath)
}

async function normalizeTypedocModuleLinks() {
  for (const pkg of typedocPackages()) {
    const packageDir = join(routesRoot, "api-reference", pkg.slug)
    const modulesDir = join(packageDir, "modules")
    const otherDir = join(packageDir, "other")
    const indexPath = join(packageDir, "index.md")
    if (!existsSync(modulesDir) || existsSync(otherDir) || !existsSync(indexPath)) continue

    const index = await readFile(indexPath, "utf8")
    await writeFile(
      indexPath,
      index.replaceAll(`/api-reference/${pkg.slug}/other`, `/api-reference/${pkg.slug}/modules`),
      "utf8"
    )
  }
}

function typedocPackages() {
  return [
    {
      slug: "core",
      label: "Core",
      packageDir: "core",
      position: 10,
      entryPoints: [
        "packages/core/src/index.ts",
        "packages/core/src/locale.ts",
        "packages/core/src/macro.ts",
      ],
    },
    {
      slug: "config",
      label: "Config",
      packageDir: "config",
      position: 20,
      entryPoints: ["packages/config/src/index.ts"],
    },
    {
      slug: "runtime",
      label: "Runtime",
      packageDir: "runtime",
      position: 30,
      entryPoints: ["packages/runtime/src/index.ts", "packages/runtime/src/server.ts"],
    },
    {
      slug: "react",
      label: "React",
      packageDir: "react",
      position: 40,
      entryPoints: [
        "packages/react/src/index.tsx",
        "packages/react/src/client.tsx",
        "packages/react/src/macro.ts",
      ],
    },
    {
      slug: "solid",
      label: "Solid",
      packageDir: "solid",
      position: 50,
      entryPoints: [
        "packages/solid/src/index.tsx",
        "packages/solid/src/client.ts",
        "packages/solid/src/runtime.ts",
        "packages/solid/src/macro.ts",
      ],
    },
    {
      slug: "vite-plugin",
      label: "Vite Plugin",
      packageDir: "vite-plugin",
      position: 60,
      entryPoints: ["packages/vite-plugin/src/index.ts"],
    },
    {
      slug: "next-plugin",
      label: "Next Plugin",
      packageDir: "next-plugin",
      position: 70,
      entryPoints: ["packages/next-plugin/src/index.ts"],
    },
    {
      slug: "transform",
      label: "Transform",
      packageDir: "transform",
      position: 80,
      entryPoints: ["packages/transform/src/index.ts", "packages/transform/src/catalogLoader.ts"],
    },
    {
      slug: "extractor",
      label: "Extractor",
      packageDir: "extractor",
      position: 90,
      entryPoints: ["packages/extractor/src/index.ts"],
    },
    {
      slug: "core-node",
      label: "Core Node",
      packageDir: "core-node",
      position: 100,
      entryPoints: ["packages/core-node/src/index.ts"],
    },
    {
      slug: "cli",
      label: "CLI",
      packageDir: "cli",
      position: 110,
      entryPoints: ["packages/cli/src/index.ts"],
    },
  ]
}

function transformLinks(content, sourcePath) {
  return content.replaceAll(
    /(!?)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (match, bang, label, href) => {
      const next = resolveHref(href, sourcePath, bang === "!")
      return `${bang}[${label}](${next})`
    }
  )
}

function resolveHref(href, sourcePath, isImage) {
  if (href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/iu.test(href) || href.startsWith("//")) {
    return href
  }

  const [hrefPath, hash = ""] = href.split("#")
  const resolved = hrefPath.startsWith("/")
    ? hrefPath.slice(1)
    : normalizeRepoPath(posix.join(posix.dirname(sourcePath), hrefPath))
  const suffix = hash === "" ? "" : `#${hash}`

  if (isImage || isAssetPath(resolved)) {
    copyAsset(resolved)
    return `/${resolved}${suffix}`
  }

  const hosted = hostedRoutes.get(normalizeRepoPath(resolved))
  if (hosted != null) {
    return `${hosted}${suffix}`
  }

  if (existsSync(join(repoRoot, resolved))) {
    const kind = extname(resolved) === "" ? "tree" : "blob"
    return `${repoUrl}/${kind}/main/${resolved}${suffix}`
  }

  return href
}

function copyAsset(repoPath) {
  const source = join(repoRoot, repoPath)
  const target = join(publicRoot, repoPath)
  if (!existsSync(source)) return
  pendingAssetCopies.push([source, target])
}

async function flushAssetCopies() {
  while (pendingAssetCopies.length > 0) {
    const [source, target] = pendingAssetCopies.shift()
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
  }
}

async function writeGeneratedFile(filePath, content) {
  await flushAssetCopies()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, "utf8")
}

async function readRepoFile(repoPath) {
  return readFile(join(repoRoot, repoPath), "utf8")
}

function stripExistingFrontmatter(content) {
  if (!content.startsWith("---\n")) return { data: "", content }
  const end = content.indexOf("\n---", 4)
  if (end === -1) return { data: "", content }
  return { data: content.slice(4, end), content: content.slice(end + 4).replace(/^\n/u, "") }
}

function extractTitle(content) {
  const match = /^#\s+(.+)$/mu.exec(content)
  return match?.[1]?.trim()
}

function extractAdrMeta(content, label) {
  const match = new RegExp(`^\\*\\*${label}:\\*\\*\\s+(.+)$`, "mu").exec(content)
  return match?.[1]?.trim()
}

function firstParagraph(content) {
  const withoutTitle = content.replace(/^#\s+.+$/mu, "")
  for (const block of withoutTitle.split(/\n{2,}/u)) {
    const paragraph = block.trim()
    if (paragraph === "" || paragraph.startsWith("#") || paragraph.startsWith("```")) continue
    if (paragraph.startsWith("|") || paragraph.startsWith("- ") || paragraph.startsWith("* "))
      continue
    return paragraph
      .replaceAll(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
      .replaceAll(/[`*_>#]/gu, "")
      .replaceAll(/\s+/gu, " ")
      .slice(0, 180)
  }
}

function toFrontmatter(data) {
  const lines = ["---"]
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === "") continue
    lines.push(`${key}: ${JSON.stringify(value)}`)
  }
  lines.push("---", "")
  return lines.join("\n")
}

function routeToFilePath(route) {
  const clean = route.replace(/^\//u, "")
  return clean === "" ? "index.md" : `${clean}/index.md`
}

function stripMarkdownExtension(fileName) {
  return fileName.replace(/\.md$/u, "")
}

function titleFromPath(repoPath) {
  const name = stripMarkdownExtension(posix.basename(repoPath)).replace(/^(\d+)-/u, "")
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function relativeRouteDir(dirPath) {
  return relative(routesRoot, dirPath).replaceAll("\\", "/")
}

function normalizeRepoPath(repoPath) {
  return posix.normalize(repoPath).replaceAll(/^\.\//gu, "")
}

function isAssetPath(repoPath) {
  return [".gif", ".jpg", ".jpeg", ".png", ".svg", ".webp"].includes(
    extname(repoPath).toLowerCase()
  )
}

await flushAssetCopies()
