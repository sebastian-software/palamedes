import fs from "node:fs"
import { chromium } from "@playwright/test"
import { afterEach, expect, test } from "vitest"

let browser

function resolveChromiumExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  }

  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if (process.platform === "darwin" && fs.existsSync(macChrome)) {
    return macChrome
  }

  return undefined
}

function activeExample() {
  return {
    baseUrl: process.env.PALAMEDES_VERIFY_BASE_URL ?? "",
    framework: process.env.PALAMEDES_VERIFY_FRAMEWORK ?? "",
    hostMismatchUrl: process.env.PALAMEDES_VERIFY_HOST_MISMATCH_URL ?? "",
    id: process.env.PALAMEDES_VERIFY_EXAMPLE_ID ?? "",
    strategy: process.env.PALAMEDES_VERIFY_STRATEGY ?? "",
  }
}

function routeUrl(baseUrl) {
  return `${baseUrl}/en`
}

async function launchPage() {
  browser = await chromium.launch({
    executablePath: resolveChromiumExecutable(),
    headless: true,
  })
  const context = await browser.newContext({
    locale: "en-US",
  })
  return context.newPage()
}

afterEach(async () => {
  await browser?.close()
  browser = undefined
})

async function currentServerLocale(page) {
  return (await page.getByTestId("server-locale-value").textContent())?.trim() ?? ""
}

async function waitForClientReady(page) {
  await page.getByTestId("client-ready").waitFor({ state: "attached", timeout: 10_000 }).catch(() => {})
}

test("matrix example browser contract", async () => {
  const example = activeExample()
  expect(example.id).not.toBe("")

  const page = await launchPage()
  const initialUrl = example.strategy === "route" ? routeUrl(example.baseUrl) : `${example.baseUrl}/`
  await page.goto(initialUrl, { waitUntil: "domcontentloaded" })

  await expect.poll(() => currentServerLocale(page)).toContain("English")

  if (example.strategy === "cookie") {
    await page.getByTestId("locale-switch-de").click({ force: true, noWaitAfter: true, timeout: 15_000 })

    try {
      await expect.poll(() => currentServerLocale(page), { timeout: 2_500 }).toContain("Deutsch")
    } catch {
      await page.reload({ waitUntil: "domcontentloaded" })
      await expect.poll(() => currentServerLocale(page)).toContain("Deutsch")
    }

    await page.reload({ waitUntil: "domcontentloaded" })
    await expect.poll(() => currentServerLocale(page)).toContain("Deutsch")

    await waitForClientReady(page)
    await page.evaluate(() => {
      document.querySelector('[data-testid="server-proof-trigger"]')?.click()
    })
    await expect
      .poll(async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? "")
      .toContain("de")
    return
  }

  await page.getByTestId("locale-switch-de").click({ force: true, noWaitAfter: true, timeout: 15_000 })
  await page.waitForURL(/\/de$/)
  expect(page.url()).toContain("/de")

  await waitForClientReady(page)
  await page.evaluate(() => {
    document.querySelector('[data-testid="server-proof-trigger"]')?.click()
  })
  await expect
    .poll(async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? "")
    .toContain("de")

  if (!example.hostMismatchUrl) {
    throw new Error(`Missing host mismatch URL for route example ${example.id}`)
  }

  await page.goto(example.hostMismatchUrl, { waitUntil: "domcontentloaded" })
  await expect
    .poll(async () => (await page.locator("body").textContent())?.trim() ?? "")
    .toContain("Locale suggestion")
  await page.getByTestId("locale-suggestion-cta").click({ force: true, noWaitAfter: true, timeout: 15_000 })
  await page.waitForURL(/\/de$/)
  expect(page.url()).toContain("/de")
  expect(page.url()).toContain("de.lvh.me")
})
