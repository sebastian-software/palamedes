import fs from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
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

  return
}

function activeExample() {
  return {
    baseUrl: process.env.PALAMEDES_VERIFY_BASE_URL ?? "",
    captureScreenshots: process.env.PALAMEDES_CAPTURE_SCREENSHOTS === "1",
    framework: process.env.PALAMEDES_VERIFY_FRAMEWORK ?? "",
    hostMismatchUrl: process.env.PALAMEDES_VERIFY_HOST_MISMATCH_URL ?? "",
    id: process.env.PALAMEDES_VERIFY_EXAMPLE_ID ?? "",
    screenshotDir: process.env.PALAMEDES_SCREENSHOT_DIR ?? "",
    strategy: process.env.PALAMEDES_VERIFY_STRATEGY ?? "",
    subdomainUrl: process.env.PALAMEDES_VERIFY_SUBDOMAIN_URL ?? "",
    tldUrl: process.env.PALAMEDES_VERIFY_TLD_URL ?? "",
  }
}

// The tld strategy derives the locale from a real top-level domain, so the
// browser must reach four distinct domains locally. Chromium's host resolver
// rules map them to the loopback dev server without touching DNS or /etc/hosts.
const TLD_TEST_HOSTS = [
  "palamedes-i18n.com",
  "palamedes-i18n.de",
  "palamedes-i18n.es",
  "palamedes-i18n.fr",
]

function tldHostResolverArgs() {
  const rules = TLD_TEST_HOSTS.map((host) => `MAP ${host} 127.0.0.1`).join(",")
  return [`--host-resolver-rules=${rules}`]
}

function routeUrl(baseUrl) {
  return `${baseUrl}/en`
}

async function launchPage(launchArgs = []) {
  browser = await chromium.launch({
    args: launchArgs,
    executablePath: resolveChromiumExecutable(),
    headless: true,
  })
  const context = await browser.newContext({
    colorScheme: "light",
    locale: "en-US",
    viewport: {
      width: 1440,
      height: 1200,
    },
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
  await page
    .getByTestId("client-ready")
    .waitFor({ state: "attached", timeout: 10_000 })
    .catch(() => {})
}

async function stabilizePage(page) {
  await page
    .addStyleTag({
      content: `
      *,
      *::before,
      *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
    })
    .catch(() => {})
}

async function captureScreenshot(page, example, state) {
  if (!example.captureScreenshots || !example.screenshotDir) {
    return
  }

  await mkdir(example.screenshotDir, { recursive: true })
  await stabilizePage(page)
  await page.screenshot({
    fullPage: true,
    path: path.join(example.screenshotDir, `${example.id}-${state}.png`),
  })
}

test("matrix example browser contract", async () => {
  const example = activeExample()
  expect(example.id).not.toBe("")

  const page = await launchPage(example.strategy === "tld" ? tldHostResolverArgs() : [])
  const initialUrl =
    example.strategy === "route"
      ? routeUrl(example.baseUrl)
      : example.strategy === "subdomain"
        ? example.subdomainUrl
        : example.strategy === "tld"
          ? example.tldUrl
          : `${example.baseUrl}/`
  await page.goto(initialUrl, { waitUntil: "domcontentloaded" })

  await expect.poll(() => currentServerLocale(page)).toContain("English")
  await captureScreenshot(page, example, "initial")

  if (example.strategy === "cookie") {
    await page
      .getByTestId("locale-switch-de")
      .click({ force: true, noWaitAfter: true, timeout: 15_000 })

    try {
      await expect.poll(() => currentServerLocale(page), { timeout: 2500 }).toContain("Deutsch")
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
      .poll(
        async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? ""
      )
      .toContain("de")
    await captureScreenshot(page, example, "interactive")
    return
  }

  if (example.strategy === "subdomain") {
    // Switching locale loads a different host (de.<base>); the leftmost DNS
    // label is authoritative, so the path stays "/".
    await page
      .getByTestId("locale-switch-de")
      .click({ force: true, noWaitAfter: true, timeout: 15_000 })
    await page.waitForURL(/de\.lvh\.me/)
    expect(page.url()).toContain("de.lvh.me")
    await expect.poll(() => currentServerLocale(page)).toContain("Deutsch")

    await waitForClientReady(page)
    await page.evaluate(() => {
      document.querySelector('[data-testid="server-proof-trigger"]')?.click()
    })
    await expect
      .poll(
        async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? ""
      )
      .toContain("de")
    await captureScreenshot(page, example, "interactive")
    return
  }

  if (example.strategy === "tld") {
    // Switching locale swaps the top-level domain (the .com host becomes a .de
    // host); the tld is authoritative for the locale, so the path stays "/".
    await page
      .getByTestId("locale-switch-de")
      .click({ force: true, noWaitAfter: true, timeout: 15_000 })
    await page.waitForURL(/palamedes-i18n\.de/)
    expect(page.url()).toContain("palamedes-i18n.de")
    await expect.poll(() => currentServerLocale(page)).toContain("Deutsch")

    await waitForClientReady(page)
    await page.evaluate(() => {
      document.querySelector('[data-testid="server-proof-trigger"]')?.click()
    })
    await expect
      .poll(
        async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? ""
      )
      .toContain("de")
    await captureScreenshot(page, example, "interactive")
    return
  }

  await page
    .getByTestId("locale-switch-de")
    .click({ force: true, noWaitAfter: true, timeout: 15_000 })
  await page.waitForURL(/\/de$/)
  expect(page.url()).toContain("/de")

  await waitForClientReady(page)
  await page.evaluate(() => {
    document.querySelector('[data-testid="server-proof-trigger"]')?.click()
  })
  await expect
    .poll(async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? "")
    .toContain("de")
  await captureScreenshot(page, example, "interactive")

  if (!example.hostMismatchUrl) {
    throw new Error(`Missing host mismatch URL for route example ${example.id}`)
  }

  await page.goto(example.hostMismatchUrl, { waitUntil: "domcontentloaded" })
  await page.getByTestId("locale-suggestion-cta").waitFor({ state: "visible", timeout: 15_000 })
  await page
    .getByTestId("locale-suggestion-cta")
    .click({ force: true, noWaitAfter: true, timeout: 15_000 })
  await page.waitForURL(/\/de$/)
  expect(page.url()).toContain("/de")
  expect(page.url()).toContain("de.lvh.me")
})
