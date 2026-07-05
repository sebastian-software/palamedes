/*
 * Headless click-through of the built site (site/build/client). Serves the
 * prerendered output, then for every route asserts the H1, zero console
 * errors, and key interactions on the home page. Runs three passes: default,
 * reduced-motion, and JS-disabled (prerendered HTML must be complete).
 *
 * Usage: node scripts/verify-site-routes.mjs  (requires a prior site build)
 */

import { createServer } from "node:http"
import { readFileSync, existsSync } from "node:fs"
import { extname, join } from "node:path"
import { dirname } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "@playwright/test"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const clientDir = join(repoRoot, "site/build/client")
const PORT = 4102

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".txt": "text/plain",
}

const ROUTES = [
  { path: "/", h1: "One translation model." },
  { path: "/frameworks", h1: "Five frameworks." },
  { path: "/proof", h1: "Claims you can re-run." },
  { path: "/get-started", h1: "First working translation" },
  { path: "/compare", h1: "Narrower than the alternatives." },
  { path: "/blog", h1: "Building i18n tooling in the" },
]

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  let filePath = join(clientDir, url.pathname)
  if (!extname(filePath)) {
    filePath = join(filePath, "index.html")
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

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" })
let failures = 0

function fail(message) {
  failures += 1
  console.error(`  !! ${message}`)
}

async function checkRoutes(context, label, { expectHydration }) {
  console.log(`— pass: ${label}`)
  const page = await context.newPage()
  const consoleErrors = []
  page.on("pageerror", (error) => consoleErrors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text())
    }
  })

  for (const route of ROUTES) {
    await page.goto(`http://localhost:${PORT}${route.path}`)
    const h1 = await page.locator("h1").first().textContent()
    if (!h1 || !h1.includes(route.h1)) {
      fail(`${label} ${route.path}: h1 mismatch, got "${h1}"`)
    } else {
      console.log(`  ok ${route.path} — "${h1.trim().slice(0, 48)}"`)
    }
  }

  if (expectHydration) {
    await page.goto(`http://localhost:${PORT}/`)
    // Matrix renders all 20 cells
    const cells = await page.locator("table tbody td").count()
    if (cells !== 20) {
      fail(`home matrix: expected 20 cells, got ${cells}`)
    }
    // Code showcase tabs toggle
    await page.getByRole("tab", { name: "Translate" }).click()
    const poVisible = await page.getByText('msgid "Your trip to Lisbon"').isVisible()
    if (!poVisible) {
      fail("code showcase: Translate tab did not reveal .po pane")
    }
    // Client-side nav via the top navigation. With viewTransition the URL
    // updates before the render commits, so wait for the target heading.
    await page.getByRole("link", { name: "Proof", exact: true }).click()
    try {
      await page
        .getByRole("heading", { level: 1, name: "Claims you can re-run." })
        .waitFor({ timeout: 5000 })
    } catch {
      fail("client-side navigation to /proof failed")
    }
  } else {
    // No-JS completeness: stats and bars must be in the static HTML
    await page.goto(`http://localhost:${PORT}/`)
    const statText = await page.getByText("browser-verified example apps").isVisible()
    const stat = await page.getByText("19.6×", { exact: false }).first().isVisible()
    if (!statText || !stat) {
      fail("no-JS: proof-strip stats missing from prerendered HTML")
    }
    const terminal = await page.getByText("✓ Extracted 640 messages", { exact: false }).isVisible()
    if (!terminal) {
      fail("no-JS: terminal cascade lines missing from prerendered HTML")
    }
  }

  if (consoleErrors.length > 0) {
    fail(`${label}: console errors: ${consoleErrors.slice(0, 3).join(" | ")}`)
  }
  await page.close()
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
