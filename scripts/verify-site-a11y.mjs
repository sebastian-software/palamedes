import assert from "node:assert/strict"

import { chromium } from "@playwright/test"
import axe from "axe-core"

const baseUrl = process.env.PALAMEDES_SITE_URL ?? "http://localhost:4100"
const paths = [
  "/",
  "/proof",
  "/frameworks",
  "/architecture",
  "/get-started",
  "/docs",
  "/decisions",
  "/blog",
]
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "desktop-200-percent-reflow", width: 720, height: 500 },
  { name: "mobile", width: 390, height: 844 },
]

const browser = await chromium.launch({ headless: true })
const failures = []

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    const runtimeErrors = []
    page.on("pageerror", (error) => runtimeErrors.push(error.message))
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text())
    })

    for (const path of paths) {
      runtimeErrors.length = 0
      await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" })
      await page.addScriptTag({ content: axe.source })
      const result = await page.evaluate(async () =>
        globalThis.axe.run(document, {
          runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
        })
      )
      if (result.violations.length > 0) {
        failures.push(
          `${viewport.name} ${path}: ${result.violations
            .map((violation) => `${violation.id} (${violation.nodes.length})`)
            .join(", ")}`
        )
      }

      const metrics = await page.evaluate(() => ({
        h1: document.querySelectorAll("h1").length,
        viewportWidth: document.documentElement.clientWidth,
        contentWidth: document.documentElement.scrollWidth,
      }))
      if (metrics.h1 !== 1)
        failures.push(`${viewport.name} ${path}: expected one h1, got ${metrics.h1}`)
      if (metrics.contentWidth > metrics.viewportWidth + 1) {
        failures.push(
          `${viewport.name} ${path}: horizontal overflow ${metrics.contentWidth}px > ${metrics.viewportWidth}px`
        )
      }
      if (runtimeErrors.length > 0) {
        failures.push(`${viewport.name} ${path}: runtime errors: ${runtimeErrors.join(" | ")}`)
      }
    }

    await context.close()
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl })
  const page = await context.newPage()
  await page.goto(baseUrl, { waitUntil: "networkidle" })
  assert.equal(await page.getByRole("link", { name: "Palamedes", exact: true }).count(), 1)

  const menuButton = page.getByRole("button", { name: /menu/i }).first()
  await menuButton.click()
  const dialog = page.getByRole("dialog")
  await assert.doesNotReject(() => dialog.waitFor({ state: "visible" }))
  const primaryAction = dialog.getByRole("link", { name: "Get started", exact: true })
  assert.equal(await primaryAction.count(), 1)
  assert.equal((await dialog.getByRole("link").allTextContents()).at(-1), "Get started")
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true)
  const closeButton = dialog.getByRole("button", { name: "Close menu" })
  const targetSizes = await Promise.all(
    [menuButton, closeButton, primaryAction].map(async (locator) => {
      const box = await locator.boundingBox()
      return box ? { width: box.width, height: box.height } : null
    })
  )
  for (const [index, box] of targetSizes.entries()) {
    if (!box || box.width < 44 || box.height < 44) {
      failures.push(`mobile control ${index + 1}: expected 44x44px, got ${JSON.stringify(box)}`)
    }
  }
  await page.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden" })

  const copyButton = page.getByRole("button", { name: /copy command/i }).first()
  await copyButton.click()
  await page.getByRole("status").filter({ hasText: "Copied" }).waitFor()

  await page.goto(`${baseUrl}/frameworks`, { waitUntil: "networkidle" })
  const matrix = page.getByLabel("Verified framework and locale strategy matrix")
  await matrix.focus()
  const initialScroll = await matrix.evaluate((element) => element.scrollLeft)
  await page.keyboard.press("ArrowRight")
  await page.waitForTimeout(250)
  assert.ok((await matrix.evaluate((element) => element.scrollLeft)) > initialScroll)
  await context.close()
} finally {
  await browser.close()
}

if (failures.length > 0) {
  throw new Error(`Site accessibility verification failed:\n- ${failures.join("\n- ")}`)
}

console.log(
  `verify-site-a11y: ${paths.length * viewports.length} route/viewport axe passes succeeded`
)
