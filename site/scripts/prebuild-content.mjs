import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, extname, join, posix, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { generateApiDocs } from "ardo/typedoc"
import {
  EXAMPLE_MATRIX,
  FOCUSED_EXAMPLES,
  LOCALE_STRATEGIES,
  SERVER_FRAMEWORKS,
  selectBrowserExamples,
  selectScreenshotExamples,
} from "../../scripts/example-matrix.mjs"
import { fetchNpmPackageStats } from "./npm-stats.mjs"

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const repoRoot = resolve(siteRoot, "..")
const routesRoot = join(siteRoot, "app/routes")
const publicRoot = join(siteRoot, "public")
const generatedDataRoot = join(siteRoot, "app/data/generated")
const repoUrl = "https://github.com/sebastian-software/palamedes"
const pendingAssetCopies = []

const NPM_PACKAGES = [
  "palamedes",
  "@palamedes/cli",
  "create-palamedes",
  "@palamedes/next-plugin",
  "@palamedes/vite-plugin",
  "@palamedes/remix",
  "@palamedes/react-router-rsc",
  "@palamedes/tanstack",
  "@palamedes/solid",
  "@palamedes/waku",
  "@palamedes/react",
]

const DOC_GROUPS = [
  {
    title: "Start and configure",
    description: "Reach a first translation, then configure the local catalog workflow.",
    match: /\/(first-working-translation|platform-support|configuration|cli|catalog-formats|mdx)$/u,
  },
  {
    title: "Integrate and operate",
    description: "Connect a host, choose locale behavior, and keep day-to-day work predictable.",
    match:
      /\/(locale-strategies|framework-example-notes|demo-deployments|backend-servers|pseudo-localization|translation-candidate-patches|troubleshooting|operations\/)/u,
  },
  {
    title: "Evaluate and migrate",
    description: "Inspect evidence, comparisons, compatibility boundaries, and migration paths.",
    match:
      /\/(migrate-from-lingui|comparison-with-lingui|approach-comparison|proof-and-benchmarks|icu-semantics-proof|benchmark-e2e-workflow|benchmark-lingui-v6-preview|migrations\/)/u,
  },
  {
    title: "Reference and policy",
    description: "Use the detailed API notes and review the project's stability and principles.",
    match: /.*/u,
  },
]

/*
 * The documentation landing page answers a different question from the
 * sidebar. Its short, reader-facing taxonomy helps someone choose a starting
 * point; the sidebar retains the four lifecycle groups used while reading.
 */
const DOC_INDEX_GROUPS = [
  {
    title: "Guides",
    description: "Start a translation workflow, connect a host, and operate it day to day.",
    match:
      /\/(first-working-translation|platform-support|configuration|cli|catalog-formats|mdx|locale-strategies|framework-example-notes|demo-deployments|backend-servers|pseudo-localization|translation-candidate-patches|troubleshooting|operations\/)/u,
  },
  {
    title: "References",
    description:
      "Look up package APIs, configuration details, compatibility notes, and project policy.",
    match: /\/(api\/|example-screenshots|stability|principles)$/u,
  },
  {
    title: "Comparisons and migrations",
    description:
      "Evaluate tradeoffs, inspect proof, and plan a migration with the supporting evidence.",
    match:
      /\/(migrate-from-lingui|comparison-with-lingui|approach-comparison|proof-and-benchmarks|icu-semantics-proof|benchmark-e2e-workflow|benchmark-lingui-v6-preview|migrations\/)/u,
  },
]

const PROGRESSIVE_OUTLINE_THRESHOLD = 5

buildTypedocPackages()

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
await writeDocsNavigation(docs)
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
await writeBlogIndexData(posts)

await writeApiReferenceIndex()
await generateTypedocReference()
await normalizeTypedocModuleLinks()
await dedupeTypedocLedes()
await ensureDirectoryIndexes(join(routesRoot, "api-reference"))

await writeContentStats(adrs)
await writeNpmStats()

console.log(
  `prebuild-content: generated ${docs.length} docs, ${adrs.length} ADRs, ${posts.length} posts, and TypeDoc API routes`
)

function buildTypedocPackages() {
  const packages = typedocPackages()
  assertTypedocEntryPoints(packages)
  const filters = packages.flatMap(({ packageDir }) => ["--filter", `./packages/${packageDir}`])
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm"

  console.log("prebuild-content: building TypeDoc workspace packages")
  const result = spawnSync(pnpm, ["--recursive", ...filters, "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  })

  if (result.error) {
    throw new Error("Could not start the TypeDoc workspace package build", {
      cause: result.error,
    })
  }
  if (result.status !== 0) {
    throw new Error(`TypeDoc workspace package build failed with status ${result.status}`)
  }
}

function assertTypedocEntryPoints(packages) {
  const missing = packages.flatMap(({ entryPoints }) =>
    entryPoints.filter((entryPoint) => !existsSync(join(repoRoot, entryPoint)))
  )
  if (missing.length > 0) {
    throw new Error(`TypeDoc entry points are missing: ${missing.join(", ")}`)
  }
}

/*
 * Derives the stat-tile numbers (ADR count, example matrix shape) from the
 * repository itself so the site cannot drift from reality when ADRs or
 * examples are added.
 */
async function writeContentStats(adrEntries) {
  const exampleDirs = (await readdir(join(repoRoot, "examples"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
  const expectedExampleIds = new Set([
    ...EXAMPLE_MATRIX.map((example) => example.id),
    ...FOCUSED_EXAMPLES,
  ])

  if (
    expectedExampleIds.size !== exampleDirs.length ||
    exampleDirs.some((id) => !expectedExampleIds.has(id))
  ) {
    throw new Error("The example matrix, focused fixtures, and examples directory must align")
  }

  const stats = {
    adrCount: adrEntries.length,
    exampleCount: exampleDirs.length,
    smokeExampleCount: EXAMPLE_MATRIX.length,
    browserExampleCount: selectBrowserExamples({}).length,
    screenshotExampleCount: selectScreenshotExamples({}).length,
    serverFrameworkCount: SERVER_FRAMEWORKS.length,
    localeStrategyCount: LOCALE_STRATEGIES.length,
  }
  await mkdir(generatedDataRoot, { recursive: true })
  await writeFile(
    join(generatedDataRoot, "content-stats.json"),
    `${JSON.stringify(stats, null, 2)}\n`
  )
  const decisionLedger = adrEntries.map((entry) => ({
    number: entry.source.match(/adr\/(\d{3})-/u)?.[1],
    title: entry.title?.replace(/^ADR-\d{3}:\s*/u, ""),
    status: entry.status,
    date: entry.date,
    href: entry.route,
  }))
  await writeFile(
    join(generatedDataRoot, "decision-ledger.json"),
    `${JSON.stringify(decisionLedger, null, 2)}\n`
  )
}

async function writeNpmStats() {
  const fetchedAt = new Date().toISOString()
  const packages = await Promise.all(NPM_PACKAGES.map((name) => fetchNpmPackageStats(name)))
  await mkdir(generatedDataRoot, { recursive: true })
  await writeFile(
    join(generatedDataRoot, "npm-stats.json"),
    `${JSON.stringify({ fetchedAt, packages }, null, 2)}\n`
  )
}

async function collectDocs() {
  const entries = []
  const topLevel = await readMarkdownFiles("docs")
  const order = new Map([
    ["first-working-translation.md", 10],
    ["platform-support.md", 15],
    ["configuration.md", 20],
    ["cli.md", 30],
    ["catalog-formats.md", 40],
    ["mdx.md", 45],
    ["locale-strategies.md", 50],
    ["framework-example-notes.md", 55],
    ["demo-deployments.md", 56],
    ["backend-servers.md", 60],
    ["migrate-from-lingui.md", 70],
    ["comparison-with-lingui.md", 80],
    ["approach-comparison.md", 90],
    ["proof-and-benchmarks.md", 100],
    ["icu-semantics-proof.md", 105],
    ["benchmark-e2e-workflow.md", 110],
    ["benchmark-lingui-v6-preview.md", 120],
    ["stability.md", 130],
    ["principles.md", 140],
    ["pseudo-localization.md", 150],
    ["translation-candidate-patches.md", 154],
    ["troubleshooting.md", 160],
  ])

  for (const fileName of topLevel) {
    entries.push({
      source: `docs/${fileName}`,
      route: `/docs/${stripMarkdownExtension(fileName)}`,
      out: join(routesRoot, "docs", fileName.replace(/\.md$/u, ".mdx")),
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
  const sourceDir = "site/content/blog"
  const files = (await readMarkdownFiles(sourceDir)).filter((fileName) => fileName !== "README.md")
  const posts = []

  for (const fileName of files) {
    const source = `${sourceDir}/${fileName}`
    const parsed = stripExistingFrontmatter(await readRepoFile(source))
    const date = extractFrontmatterMeta(parsed.data, "date")
    if (!date) {
      throw new Error(`Blog post ${source} is missing required date frontmatter`)
    }
    const title = extractFrontmatterMeta(parsed.data, "title")
    const excerpt = extractFrontmatterMeta(parsed.data, "excerpt")
    const readMinutes = Number(extractFrontmatterMeta(parsed.data, "readMinutes"))
    const order = Number(extractFrontmatterMeta(parsed.data, "order"))
    if (!title || !excerpt || !Number.isInteger(readMinutes) || !Number.isFinite(order)) {
      throw new Error(
        `Blog post ${source} requires title, excerpt, readMinutes, and order frontmatter`
      )
    }
    posts.push({
      source,
      route: `/blog/${stripMarkdownExtension(fileName)}`,
      out: join(routesRoot, "blog", fileName),
      order,
      date,
      title,
      excerpt,
      readMinutes,
    })
  }

  return posts.sort(
    (left, right) => right.date.localeCompare(left.date) || left.order - right.order
  )
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
  const summaries = await Promise.all(docs.map(readEntrySummary))
  const lines = [
    "---",
    'title: "Documentation"',
    'description: "Guides, references, operations notes, and migration material for Palamedes."',
    "order: 0",
    "---",
    "",
    "# Documentation",
    "",
    '<p className="pmds-docs-micro-label">Field guide / maintained from source</p>',
    "",
    "Canonical source files still live under `docs/`; this page groups the generated routes by the question in front of you.",
    "",
  ]
  for (const group of DOC_INDEX_GROUPS) {
    const entries = summaries.filter((entry) => indexDocGroupFor(entry.route) === group)
    if (entries.length === 0) continue
    lines.push(`## ${group.title}`, "", group.description, "", "<CardGroup cols={2}>")
    for (const entry of entries) {
      lines.push(
        `<Card title=${JSON.stringify(entry.title)} href=${JSON.stringify(entry.route)}>`,
        entry.description ?? "Open the generated documentation page.",
        "</Card>"
      )
    }
    lines.push("</CardGroup>", "")
  }
  await writeGeneratedFile(join(routesRoot, "docs/index.md"), lines.join("\n"))
}

async function writeDocsNavigation(docs) {
  const sidebarDocs = docs.filter((doc) => !doc.source.startsWith("docs/api/"))
  const summaries = await Promise.all(sidebarDocs.map(readEntrySummary))
  const groups = DOC_GROUPS.map((group, index) => ({
    title: group.title,
    collapsed: index > 0,
    items: summaries
      .filter((entry) => docGroupFor(entry.route) === group)
      .map(({ title, route }) => ({ title, route })),
  })).filter((group) => group.items.length > 0)
  await mkdir(generatedDataRoot, { recursive: true })
  await writeFile(
    join(generatedDataRoot, "docs-navigation.json"),
    `${JSON.stringify(groups, null, 2)}\n`
  )
}

async function writeDecisionsIndex(adrs) {
  const lines = [
    "---",
    'title: "Decision Records"',
    'description: "Generated index of the Palamedes product, architecture, communication, and operational decision records."',
    "order: 0",
    "---",
    "",
    "# Decision Records",
    "",
    '<p className="pmds-docs-micro-label">Decision trail / recorded in the repository</p>',
    "",
    "The ADR files remain canonical in `adr/`. This decision trail is generated from their current title, status, and date during the site prebuild.",
    "",
    "| No. | Decision | Status | Date |",
    "| ---: | --- | --- | --- |",
  ]

  for (const adr of adrs) {
    const content = await readRepoFile(adr.source)
    const title = extractTitle(content) ?? titleFromPath(adr.source)
    const number = adr.source.match(/adr\/(\d{3})-/u)?.[1] ?? "—"
    const status = extractAdrMeta(content, "Status") ?? "—"
    const date = extractAdrMeta(content, "Date") ?? "—"
    const shortTitle = title.replace(/^ADR-\d{3}:\s*/u, "")
    lines.push(`| ${number} | [${shortTitle}](${adr.route}) | ${status} | ${date} |`)
  }
  lines.push("")
  await writeGeneratedFile(join(routesRoot, "decisions/index.md"), lines.join("\n"))
}

async function writeBlogIndexData(posts) {
  const data = posts.map(({ title, excerpt, route, readMinutes, date }) => ({
    title,
    excerpt,
    href: route,
    readMinutes,
    date,
  }))
  await mkdir(generatedDataRoot, { recursive: true })
  await writeFile(join(generatedDataRoot, "blog-posts.json"), `${JSON.stringify(data, null, 2)}\n`)
}

async function readEntrySummary(entry) {
  const parsed = stripExistingFrontmatter(await readRepoFile(entry.source))
  const lede = extractLede(parsed.content)
  return {
    title: extractTitle(parsed.content) ?? titleFromPath(entry.source),
    description: lede?.text,
    route: entry.route,
  }
}

function docGroupFor(route) {
  return DOC_GROUPS.find((group) => group.match.test(route))
}

function indexDocGroupFor(route) {
  if (route.startsWith("/docs/api/")) return DOC_INDEX_GROUPS[1]
  return DOC_INDEX_GROUPS.find((group) => group.match.test(route)) ?? DOC_INDEX_GROUPS[1]
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
  const lede = extractLede(parsed.content)
  const description = lede?.text
  const status = extractAdrMeta(parsed.content, "Status")
  const date = entry.date ?? extractAdrMeta(parsed.content, "Date")
  const body = lede ? removeLedeBlock(parsed.content, lede) : parsed.content
  const content = transformLinks(body, entry.source)
  const usesProgressiveOutline =
    entry.source.startsWith("docs/") &&
    countTopLevelHeadings(content) > PROGRESSIVE_OUTLINE_THRESHOLD
  const frontmatter = {
    title,
    description,
    order: entry.order,
    ...(date ? { date } : {}),
    ...(status ? { status } : {}),
    ...(usesProgressiveOutline ? { outline: false } : {}),
  }
  entry.title ??= title
  entry.status = status
  entry.date = date
  const progressiveOutline = usesProgressiveOutline
    ? `${renderProgressiveOutline(buildProgressiveOutlineItems(content))}\n\n`
    : ""
  await writeGeneratedFile(
    entry.out,
    `${toFrontmatter(frontmatter)}\n${progressiveOutline}${content.trim()}\n`
  )
}

function countTopLevelHeadings(content) {
  let fence = null
  let count = 0

  for (const line of content.split("\n")) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence == null) fence = marker
      else if (fence === marker) fence = null
      continue
    }
    if (fence == null && /^##(?!#)\s+\S/u.test(line)) count += 1
  }

  return count
}

function buildProgressiveOutlineItems(content) {
  const items = []
  const slugs = new Map()
  let fence = null

  for (const line of content.split("\n")) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/u.exec(line)
    if (fenceMatch) {
      const marker = fenceMatch[1][0]
      if (fence == null) fence = marker
      else if (fence === marker) fence = null
      continue
    }
    if (fence != null) continue

    const heading = /^##(?!#)\s+(.+?)\s*#*\s*$/u.exec(line)
    if (!heading) continue

    const text = heading[1]
    const base = slugifyHeading(text) || `heading-${items.length}`
    const duplicate = slugs.get(base) ?? 0
    slugs.set(base, duplicate + 1)
    items.push({
      id: duplicate === 0 ? base : `${base}-${duplicate}`,
      text,
      depth: 2,
    })
  }

  return items
}

function slugifyHeading(text) {
  let slug = text
    .replace(/<[^>]*>/gu, "")
    .toLowerCase()
    .trim()
    .replaceAll(/[`*_~[\]()]/gu, "")
    .replaceAll(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .replaceAll(/[\s_]+/gu, "-")

  while (slug.includes("--")) slug = slug.replaceAll("--", "-")
  return slug.replaceAll(/^-|-$/gu, "")
}

function renderProgressiveOutline(items) {
  const visibleItems = items.slice(0, 4)
  const remainingItems = items.slice(4)
  return [
    '<section className="pmds-progressive-outline" aria-labelledby="page-outline-title">',
    '<p id="page-outline-title" className="pmds-progressive-outline-label">Page outline</p>',
    '<nav aria-label="Page outline">',
    renderProgressiveOutlineList(visibleItems),
    '<details className="pmds-progressive-outline-more">',
    `<summary>More sections (${remainingItems.length})</summary>`,
    renderProgressiveOutlineList(remainingItems),
    "</details>",
    "</nav>",
    "</section>",
  ].join("\n")
}

function renderProgressiveOutlineList(items) {
  return [
    '<ol className="pmds-progressive-outline-list">',
    ...items.map(
      (item) =>
        `<li data-depth="${item.depth}"><a href="#${item.id}">${escapeHtml(item.text)}</a></li>`
    ),
    "</ol>",
  ].join("\n")
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
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

/*
 * The TypeDoc generator repeats the frontmatter `description` as the first
 * body paragraph. ARDO's ContentHeader already renders the description as the
 * visible lede, so drop the duplicated paragraph (same rule as extractLede /
 * removeLedeBlock for hand-written pages).
 */
async function dedupeTypedocLedes() {
  const apiRoot = join(routesRoot, "api-reference")
  if (!existsSync(apiRoot)) return
  const entries = await readdir(apiRoot, { recursive: true, withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const filePath = join(entry.parentPath, entry.name)
    const raw = await readFile(filePath, "utf8")
    const parsed = stripExistingFrontmatter(raw)
    const description = /^description:\s*["']?(.*?)["']?\s*$/mu.exec(parsed.data)?.[1]
    if (!description) continue
    const normalize = (text) => text.replaceAll(/\s+/gu, " ").replace(/\.$/u, "").trim()
    const lede = extractLede(parsed.content)
    if (!lede || normalize(lede.text) !== normalize(description)) continue
    const body = removeLedeBlock(parsed.content, lede)
    await writeFile(filePath, `---\n${parsed.data}\n---\n${body.trimStart()}`, "utf8")
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
      slug: "react-router-rsc",
      label: "React Router RSC",
      packageDir: "react-router-rsc",
      position: 45,
      entryPoints: ["packages/react-router-rsc/src/index.ts"],
    },
    {
      slug: "solid",
      label: "Solid",
      packageDir: "solid",
      position: 50,
      entryPoints: ["packages/solid/src/index.tsx", "packages/solid/src/macro.ts"],
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
      slug: "waku",
      label: "Waku",
      packageDir: "waku",
      position: 75,
      entryPoints: ["packages/waku/src/index.ts"],
    },
    {
      slug: "tanstack",
      label: "TanStack Start",
      packageDir: "tanstack",
      position: 76,
      entryPoints: ["packages/tanstack/src/index.ts"],
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
  const match = new RegExp(`^(?:\\*\\*${label}:\\*\\*|- ${label}:)\\s+(.+)$`, "mu").exec(content)
  return match?.[1]?.trim()
}

function extractFrontmatterMeta(data, label) {
  const match = new RegExp(`^${label}:\\s+(.+)$`, "mu").exec(data)
  return match?.[1]?.trim().replace(/^["']|["']$/gu, "")
}

/*
 * Finds the lede: the first real prose paragraph. Returns the cleaned text
 * (for frontmatter `description`) plus the exact [start, end) offsets of the
 * paragraph so the caller can remove it from the body — ARDO's ContentHeader
 * already renders the description as the visible lede, so leaving the
 * paragraph in the body would print it twice on every page.
 *
 * Heading lines are skipped *inside* a block (not by discarding the whole
 * block), so `# Title\nLede` with a single newline still yields the lede.
 */
function extractLede(content) {
  let cursor = 0
  for (const block of content.split(/\n{2,}/u)) {
    const blockStart = content.indexOf(block, cursor)
    cursor = blockStart + block.length

    let inner = block
    let innerOffset = 0
    for (;;) {
      const lineBreak = inner.indexOf("\n")
      const firstLine = (lineBreak === -1 ? inner : inner.slice(0, lineBreak)).trim()
      if (firstLine !== "" && !/^#{1,6}\s/u.test(firstLine)) break
      if (lineBreak === -1) {
        inner = ""
        break
      }
      innerOffset += lineBreak + 1
      inner = inner.slice(lineBreak + 1)
    }

    const paragraph = inner.trim()
    if (paragraph === "" || paragraph.startsWith("#") || paragraph.startsWith("```")) continue
    if (paragraph.startsWith("|") || paragraph.startsWith("- ") || paragraph.startsWith("* "))
      continue
    if (/^\*\*(Status|Date):\*\*/u.test(paragraph)) continue
    if (/^(Status|Date):/u.test(paragraph)) continue
    return {
      start: blockStart + innerOffset,
      end: blockStart + block.length,
      text: paragraph
        .replaceAll(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
        .replaceAll(/[`*_>#]/gu, "")
        .replaceAll(/\s+/gu, " "),
    }
  }
}

/* Removes exactly the paragraph found by extractLede, anchored by offsets —
 * a lede repeated verbatim later in the document is never touched. */
function removeLedeBlock(content, lede) {
  return content.slice(0, lede.start) + content.slice(lede.end)
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
