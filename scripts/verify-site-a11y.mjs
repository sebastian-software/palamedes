import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "@playwright/test"
import axe from "axe-core"
import { startSiteStaticServer } from "./site-static-server.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const PORT = 4104
const staticServer = process.env.PALAMEDES_SITE_URL
  ? null
  : await startSiteStaticServer({ clientDir: join(repoRoot, "site/build/client"), port: PORT })
const baseUrl = process.env.PALAMEDES_SITE_URL ?? staticServer.baseUrl
const paths = [
  "/",
  "/proof",
  "/frameworks",
  "/architecture",
  "/get-started",
  "/guides",
  "/react-server-components-i18n",
  "/i18n-performance",
  "/icu-messageformat",
  "/locale-routing",
  "/docs",
  "/decisions",
  "/blog",
]
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "desktop-200-percent-reflow", width: 720, height: 500 },
  { name: "mobile", width: 390, height: 844 },
]

const chromiumExecutable = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/opt/pw-browsers/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find((path) => path && existsSync(path))

const failures = []
let browser

try {
  browser = await chromium.launch({
    headless: true,
    ...(chromiumExecutable ? { executablePath: chromiumExecutable } : {}),
  })
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

  for (const width of [320, 390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 844 } })
    const page = await context.newPage()
    await page.goto(`${baseUrl}/icu-messageformat`, { waitUntil: "networkidle" })
    assert.equal(await page.getByRole("link", { name: "Palamedes", exact: true }).count(), 1)

    const menuButton = page.getByRole("button", { name: /menu/i }).first()
    await menuButton.focus()
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog")
    await assert.doesNotReject(() => dialog.waitFor({ state: "visible" }))
    const navigation = dialog.getByRole("navigation")
    const navigationLinks = navigation.getByRole("link")
    assert.deepEqual(await navigationLinks.allTextContents(), [
      "Frameworks",
      "Architecture",
      "Guides",
      "Docs",
    ])
    assert.equal(await navigation.getByRole("group", { name: "Evaluate" }).count(), 1)
    assert.equal(await navigation.getByRole("group", { name: "Resources" }).count(), 1)
    assert.equal(
      await navigation
        .getByRole("link", { name: "Guides", exact: true })
        .getAttribute("aria-current"),
      "page"
    )

    const primaryAction = dialog.getByRole("link", { name: "Get started", exact: true })
    assert.equal(await primaryAction.count(), 1)
    assert.equal((await dialog.getByRole("link").allTextContents()).at(-1), "Get started")
    assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true)
    assert.equal(
      await dialog.evaluate((element) => {
        const nav = element.querySelector("nav")
        const action = [...element.querySelectorAll("a")].find(
          (link) => link.textContent?.trim() === "Get started"
        )
        return Boolean(
          nav && action && nav.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING
        )
      }),
      true
    )

    const closeButton = dialog.getByRole("button", { name: "Close menu" })
    const targetLocators = [
      menuButton,
      closeButton,
      ...(await navigationLinks.all()),
      primaryAction,
    ]
    const targetSizes = await Promise.all(
      targetLocators.map(async (locator) => {
        const box = await locator.boundingBox()
        return box ? { width: box.width, height: box.height } : null
      })
    )
    for (const [index, box] of targetSizes.entries()) {
      if (!box || box.width < 44 || box.height < 44) {
        failures.push(
          `mobile ${width}px control ${index + 1}: expected 44x44px, got ${JSON.stringify(box)}`
        )
      }
    }

    const focusedStyle = await page.evaluate(() => {
      const focused = document.activeElement
      if (!(focused instanceof HTMLElement)) return null
      const style = getComputedStyle(focused)
      return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
    })
    if (
      !focusedStyle ||
      focusedStyle.outlineStyle === "none" ||
      Number.parseFloat(focusedStyle.outlineWidth) < 2
    ) {
      failures.push(`mobile ${width}px: initial dialog focus is not visibly outlined`)
    }

    const dialogWidth = await dialog.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    if (dialogWidth.scrollWidth > dialogWidth.clientWidth + 1) {
      failures.push(
        `mobile ${width}px: dialog overflows ${dialogWidth.scrollWidth}px > ${dialogWidth.clientWidth}px`
      )
    }

    await closeButton.click()
    await dialog.waitFor({ state: "hidden" })
    assert.equal(await menuButton.evaluate((element) => element === document.activeElement), true)

    await page.keyboard.press("Enter")
    await dialog.waitFor({ state: "visible" })
    await page.keyboard.press("Escape")
    await dialog.waitFor({ state: "hidden" })
    assert.equal(await menuButton.evaluate((element) => element === document.activeElement), true)

    await page.keyboard.press("Enter")
    await dialog.waitFor({ state: "visible" })
    await dialog.getByRole("link", { name: "Frameworks", exact: true }).click()
    await page.waitForURL(`${baseUrl}/frameworks`)
    await dialog.waitFor({ state: "hidden" })
    await context.close()
  }

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseUrl })
  const page = await context.newPage()
  await page.goto(baseUrl, { waitUntil: "networkidle" })
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
  await browser?.close()
  await staticServer?.close()
}

if (failures.length > 0) {
  throw new Error(`Site accessibility verification failed:\n- ${failures.join("\n- ")}`)
}

console.log(
  `verify-site-a11y: ${paths.length * viewports.length} route/viewport axe passes succeeded`
)
