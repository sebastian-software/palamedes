/*
 * Renders a per-topic Open Graph image (1200×630) for every entry in
 * data/topics.ts and writes it to site/public/og/<slug>.png.
 *
 * The output is committed rather than generated during the build: the build
 * runs in CI on machines that have no reason to carry a browser, and an OG
 * image that fails to render should not fail a deploy. Re-run this after
 * changing a topic's ogTitle:
 *
 *   node site/scripts/generate-og-images.mjs
 *
 * --check verifies every topic has an image without rendering anything, which
 * is cheap enough to run in the normal build.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const siteRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const outDir = join(siteRoot, "public/og")

/*
 * topics.ts is TypeScript with imports, so it cannot simply be require()d from
 * a plain node script. The slugs and OG titles are extracted textually — a
 * deliberate trade: the alternative is a bundler step for a script that runs
 * by hand a few times a year. The --check mode below catches any drift.
 */
function readTopics() {
  const source = readFileSync(join(siteRoot, "app/data/topics.ts"), "utf8")
  const topics = []
  for (const match of source.matchAll(/slug: "([^"]+)",\n\s*metaTitle:\s*(?:`|")([^`"]+)/gu)) {
    const [, slug, metaTitle] = match
    // The part before the em dash is the claim; the rest is supporting detail.
    const headline = metaTitle.split(" — ")[0].trim()
    const kicker = (metaTitle.split(" — ")[1] ?? "").trim()
    topics.push({ slug, headline, kicker })
  }
  if (topics.length === 0) throw new Error("generate-og-images: parsed no topics from topics.ts")
  return topics
}

const topics = readTopics()

if (process.argv.includes("--check")) {
  const missing = topics.filter((topic) => !existsSync(join(outDir, `${topic.slug}.png`)))
  if (missing.length > 0) {
    console.error(
      `generate-og-images: missing images for ${missing.map((topic) => topic.slug).join(", ")}\n` +
        "Run: node site/scripts/generate-og-images.mjs"
    )
    process.exit(1)
  }
  console.log(`generate-og-images: ${topics.length} topic images present`)
  process.exit(0)
}

const { chromium } = await import("@playwright/test")

const fontData = readFileSync(join(siteRoot, "public/fonts/CinzelHellenic-Regular.woff2")).toString(
  "base64"
)

function html({ headline, kicker }) {
  return `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: "Cinzel Hellenic";
    src: url(data:font/woff2;base64,${fontData}) format("woff2");
    font-weight: 400;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; display: flex; flex-direction: column;
    justify-content: space-between;
    background: #faf9f4; color: #0e2a4d;
    font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
    padding: 64px 72px;
    border-top: 10px solid #8e6628;
  }
  .mark {
    font-family: "Cinzel Hellenic", serif; font-size: 24px;
    letter-spacing: 0.28em; text-transform: uppercase; color: #0e2a4d;
  }
  h1 {
    font-family: "Cinzel Hellenic", serif;
    font-size: 62px; line-height: 1.14; font-weight: 400;
    max-width: 20em; letter-spacing: -0.005em;
  }
  p {
    font-size: 23px; line-height: 1.5; color: #0e2a4dcc;
    max-width: 42em; margin-top: 22px;
  }
  .rule { height: 1px; background: #0e2a4d26; margin: 30px 0 0; }
  footer {
    display: flex; justify-content: space-between; align-items: baseline;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 17px; letter-spacing: 0.06em; color: #8e6628;
  }
</style>
<div class="mark">Palamedes</div>
<div>
  <h1>${headline}</h1>
  ${kicker ? `<p>${kicker}</p>` : ""}
  <div class="rule"></div>
</div>
<footer><span>palamedes.dev</span><span>Rust-powered i18n for JS</span></footer>`
}

mkdirSync(outDir, { recursive: true })

const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/opt/pw-browsers/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((path) => path && existsSync(path))

const browser = await chromium.launch(executablePath ? { executablePath } : undefined)
const context = await browser.newContext({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1,
})
const page = await context.newPage()

for (const topic of topics) {
  await page.setContent(html(topic), { waitUntil: "networkidle" })
  await page.evaluate(() => document.fonts.ready)
  const target = join(outDir, `${topic.slug}.png`)
  await page.screenshot({ path: target })
  console.log(`  wrote public/og/${topic.slug}.png — "${topic.headline}"`)
}

await browser.close()
console.log(`generate-og-images: ${topics.length} images written`)
