/*
 * Headless click-through of the built site (site/build/client). Serves the
 * prerendered output, then crawls every sitemap route, asserts key H1s, checks
 * zero console errors, and exercises important interactions. Runs three passes:
 * default, reduced-motion, and JS-disabled.
 *
 * Usage: node scripts/verify-site-routes.mjs  (requires a prior site build)
 */

import { createServer } from "node:http"
import { existsSync, readFileSync, statSync } from "node:fs"
import { dirname, extname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "@playwright/test"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const clientDir = join(repoRoot, "site/build/client")
const PORT = 4102

const MIME = {
  ".css": "text/css",
  ".html": "text/html",
  ".js": "text/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".xml": "application/xml",
}

const ROUTE_EXPECTATIONS = [
  { path: "/", h1: "One translation model." },
  { path: "/frameworks", h1: "Five frameworks." },
  { path: "/proof", h1: "Claims you can re-run." },
  { path: "/get-started", h1: "First working translation" },
  { path: "/compare", h1: "Narrower than the alternatives." },
  { path: "/blog", h1: "Building i18n tooling in the" },
  { path: "/blog/measuring-palamedes-honestly", h1: "Measuring Palamedes Honestly" },
  { path: "/docs", h1: "Documentation" },
  { path: "/docs/cli", h1: "CLI Reference" },
  { path: "/docs/example-screenshots", h1: "Example Screenshots" },
  { path: "/decisions", h1: "Architecture Decisions" },
  {
    path: "/decisions/003-source-string-first-message-identity",
    h1: "ADR-003: Source-String-First Message Identity",
  },
  { path: "/api-reference", h1: "Generated API Reference" },
  { path: "/api-reference/core", h1: "Core" },
  { path: "/api-reference/config", h1: "Config" },
  { path: "/api-reference/config/functions", h1: "Functions" },
  { path: "/api-reference/config/types", h1: "Types" },
]

const sitemapPaths = readSitemapPaths()

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const hasExtension = extname(url.pathname) !== ""
  let filePath = join(clientDir, url.pathname)
  if (!extname(filePath)) {
    filePath = join(filePath, "index.html")
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html")
  }
  if (!existsSync(filePath) && !hasExtension) {
    filePath = join(clientDir, "__spa-fallback.html")
  }
  if (!existsSync(filePath)) {
    res.writeHead(404)
    res.end("not found")
    return
  }
  res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" })
  res.end(readFileSync(filePath))
})

await new Promise((resolve) => server.listen(PORT, resolve))

if (
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE &&
  !existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)
) {
  console.warn(
    `  !! PLAYWRIGHT_CHROMIUM_EXECUTABLE is set but does not exist: ${process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}`
  )
}

const chromiumExecutable = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/opt/pw-browsers/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find((path) => path && existsSync(path))

const browser = await chromium.launch(
  chromiumExecutable ? { executablePath: chromiumExecutable } : undefined
)
let failures = 0

function fail(message) {
  failures += 1
  console.error(`  !! ${message}`)
}

function readSitemapPaths() {
  const sitemapPath = join(clientDir, "sitemap.xml")
  if (!existsSync(sitemapPath)) {
    console.error(`missing ${sitemapPath}; run pnpm build:site first`)
    process.exit(1)
  }
  const sitemap = readFileSync(sitemapPath, "utf8")
  const paths = [...sitemap.matchAll(/<loc>https:\/\/palamedes\.dev([^<]+)<\/loc>/gu)]
    .map((match) => match[1])
    .filter((path) => path !== "/404")
  if (paths.length === 0) {
    console.error("sitemap.xml did not contain any palamedes.dev routes")
    process.exit(1)
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right))
}

async function checkRoutes(context, label, { expectHydration }) {
  console.log(`— pass: ${label}`)
  const consoleErrors = []

  if (!expectHydration) {
    for (const path of sitemapPaths) {
      const page = await context.newPage()
      trackPageErrors(page, () => path, consoleErrors)
      const response = await gotoAndSettle(page, path, { settleMs: 100 })
      if (response?.status() !== 200) {
        fail(`${label} ${path}: expected HTTP 200, got ${response?.status() ?? "no response"}`)
        await page.close()
        continue
      }
      const bodyText = await page.locator("body").innerText()
      if (bodyText.trim().length === 0) {
        fail(`${label} ${path}: empty body`)
      }
      await page.close()
    }
    console.log(`  ok crawled ${sitemapPaths.length} sitemap routes`)
  }

  for (const route of ROUTE_EXPECTATIONS) {
    const routePage = await context.newPage()
    trackPageErrors(routePage, () => route.path, consoleErrors)
    await gotoAndSettle(routePage, route.path, { settleMs: 1500 })
    const h1 = await routePage.locator("h1").first().textContent()
    if (!h1 || !h1.includes(route.h1)) {
      fail(`${label} ${route.path}: h1 mismatch, got "${h1}"`)
    } else {
      console.log(`  ok ${route.path} — "${h1.trim().slice(0, 48)}"`)
    }
    await routePage.close()
  }

  const page = await context.newPage()
  let currentPath = "(startup)"
  trackPageErrors(page, () => currentPath, consoleErrors)

  if (expectHydration) {
    currentPath = "/"
    await gotoAndSettle(page, "/", { settleMs: 1500 })
    // Matrix renders all 20 cells.
    const cells = await page.locator("table tbody td").count()
    if (cells !== 20) {
      fail(`home matrix: expected 20 cells, got ${cells}`)
    }
    // Code showcase tabs toggle.
    await page.getByRole("tab", { name: "Translate" }).click()
    const poVisible = await page.getByText('msgid "Your trip to Lisbon"').isVisible()
    if (!poVisible) {
      fail("code showcase: Translate tab did not reveal .po pane")
    }
    // Get-started stack picker switches the six-step flow per stack.
    currentPath = "/get-started"
    await gotoAndSettle(page, "/get-started", { settleMs: 1500 })
    await page.getByRole("tab", { name: "Vite + Solid" }).click()
    const solidVisible = await page.getByText("vite-plugin-solid").first().isVisible()
    if (!solidVisible) {
      fail("get-started: Solid tab did not reveal Solid setup")
    }
    await page.getByRole("tab", { name: "Next.js" }).click()
    const nextVisible = await page.getByText("@palamedes/next-plugin").first().isVisible()
    if (!nextVisible) {
      fail("get-started: Next.js tab did not reveal Next setup")
    }
    // Client-side nav via the top navigation. With viewTransition the URL
    // updates before the render commits, so wait for the target heading.
    await page.getByRole("banner").getByRole("link", { name: "Proof", exact: true }).click()
    try {
      await page
        .getByRole("heading", { level: 1, name: "Claims you can re-run." })
        .waitFor({ timeout: 5000 })
    } catch {
      fail("client-side navigation to /proof failed")
    }
  } else {
    // No-JS completeness: stats and bars must be in the static HTML.
    currentPath = "/"
    await gotoAndSettle(page, "/", { settleMs: 100 })
    const statText = await page.getByText("browser-verified example apps").isVisible()
    const stat = await page.getByText("19.6", { exact: false }).first().isVisible()
    if (!statText || !stat) {
      fail("no-JS: proof-strip stats missing from prerendered HTML")
    }
    const terminal = await page.getByText("Extracted 640 messages", { exact: false }).isVisible()
    if (!terminal) {
      fail("no-JS: terminal cascade lines missing from prerendered HTML")
    }
  }

  if (consoleErrors.length > 0) {
    fail(`${label}: console errors: ${consoleErrors.slice(0, 3).join(" | ")}`)
  }
  await page.close()
}

function trackPageErrors(page, getPath, consoleErrors) {
  page.on("pageerror", (error) => {
    const message = error.message
    if (!isKnownArdoBreadcrumbHydrationWarning(getPath(), message)) {
      consoleErrors.push(`${getPath()}: ${message}`)
    }
  })
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text()
      if (!isKnownArdoBreadcrumbHydrationWarning(getPath(), text)) {
        consoleErrors.push(`${getPath()}: ${text}`)
      }
    }
  })
  page.on("response", (response) => {
    if (response.status() >= 400) {
      consoleErrors.push(`${getPath()}: HTTP ${response.status()} ${response.url()}`)
    }
  })
}

function isKnownArdoBreadcrumbHydrationWarning(path, message) {
  return (
    path !== "/" && message.includes("Minified React error #418") && message.includes("args[]=HTML")
  )
}

async function gotoAndSettle(page, path, { settleMs }) {
  const response = await page.goto(`http://localhost:${PORT}${path}`)
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(settleMs)
  return response
}

await checkRoutes(await browser.newContext(), "default", { expectHydration: true })
await checkRoutes(await browser.newContext({ reducedMotion: "reduce" }), "reduced-motion", {
  expectHydration: true,
})
await checkRoutes(await browser.newContext({ javaScriptEnabled: false }), "no-js", {
  expectHydration: false,
})

await browser.close()
server.close()

if (failures > 0) {
  console.error(`verify-site-routes: ${failures} failure(s)`)
  process.exit(1)
}
console.log("verify-site-routes: all checks passed")
