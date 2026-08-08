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

function hasClientLocaleProbe(example) {
  return ["solidstart-cookie", "tanstack-cookie", "waku-cookie"].includes(example.id)
}

function hasServerDocumentLocale(example) {
  return example.id !== "waku-cookie"
}

function documentLocale(example, locale) {
  return hasServerDocumentLocale(example) ? locale : "en"
}

function isHydrationMismatch(message) {
  return (
    /\b(?:hydration|hydrate|hydrated)\b.*\b(?:mismatch|failed|error)/iu.test(message) ||
    /\b(?:server rendered|server-rendered)\b.*\b(?:html|text|markup)/iu.test(message) ||
    /\b(?:text content|html)\b.*\b(?:does not match|did not match|mismatch)/iu.test(message)
  )
}

async function launchPage(launchArgs = [], { browserLocale = "en-US", navigatorLocale } = {}) {
  browser = await chromium.launch({
    args: launchArgs,
    executablePath: resolveChromiumExecutable(),
    headless: true,
  })
  const context = await browser.newContext({
    colorScheme: "light",
    locale: browserLocale,
    viewport: {
      width: 1440,
      height: 1200,
    },
  })
  const page = await context.newPage()

  if (navigatorLocale) {
    await page.addInitScript((locale) => {
      Object.defineProperties(navigator, {
        language: {
          configurable: true,
          get: () => locale,
        },
        languages: {
          configurable: true,
          get: () => [locale],
        },
      })
    }, navigatorLocale)
  }

  return page
}

afterEach(async () => {
  await browser?.close()
  browser = undefined
})

async function currentServerLocale(page) {
  return (await page.getByTestId("server-locale-value").textContent())?.trim() ?? ""
}

async function waitForClientReady(page) {
  await page.getByTestId("client-ready").waitFor({ state: "attached", timeout: 10_000 })
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

  const page = await launchPage(example.strategy === "tld" ? tldHostResolverArgs() : [], {
    // The browser sends es-ES to SSR, while client code sees en-US. A client
    // bootstrap which chooses navigator.language would therefore diverge from
    // the Spanish server document during hydration.
    browserLocale: example.strategy === "cookie" ? "es-ES" : "en-US",
    navigatorLocale: example.strategy === "cookie" ? "en-US" : undefined,
  })
  const pageErrors = []
  const hydrationErrors = []
  page.on("pageerror", (error) => pageErrors.push(error.message))
  page.on("console", (message) => {
    if (message.type() === "error" && isHydrationMismatch(message.text())) {
      hydrationErrors.push(message.text())
    }
  })

  const initialUrl =
    example.strategy === "route"
      ? routeUrl(example.baseUrl)
      : example.strategy === "subdomain"
        ? example.subdomainUrl
        : example.strategy === "tld"
          ? example.tldUrl
          : `${example.baseUrl}/`
  await page.goto(initialUrl, { waitUntil: "domcontentloaded" })

  if (example.strategy === "client") {
    const mdxPage = page.getByTestId("mdx-page")
    await expect
      .poll(async () => (await mdxPage.textContent())?.trim() ?? "")
      .toContain("Palamedes MDX handbook")

    await page.getByTestId("page-link-extraction").click()
    await expect
      .poll(async () => (await mdxPage.textContent())?.trim() ?? "")
      .toContain("Extract once, render everywhere")

    await page.getByTestId("page-link-runtime").click()
    await expect
      .poll(async () => (await mdxPage.textContent())?.trim() ?? "")
      .toContain("One locale per document")

    await page.getByTestId("locale-switch-de").click()
    await expect
      .poll(async () => (await mdxPage.textContent())?.trim() ?? "")
      .toContain("Eine Sprache pro Dokument")

    await page.getByTestId("page-link-welcome").click()
    await expect
      .poll(async () => (await mdxPage.textContent())?.trim() ?? "")
      .toContain("Palamedes-MDX-Handbuch")
    await captureScreenshot(page, example, "interactive")
    return
  }

  await expect
    .poll(() => currentServerLocale(page))
    .toMatch(example.strategy === "cookie" ? /español/iu : /english/iu)
  await expect
    .poll(() => page.locator("html").getAttribute("lang"))
    .toBe(documentLocale(example, example.strategy === "cookie" ? "es" : "en"))
  await waitForClientReady(page)
  expect(pageErrors).toEqual([])
  if (hasClientLocaleProbe(example)) {
    await expect
      .poll(() => page.getByTestId("client-locale-value").textContent())
      .toBe("Añadir al carrito")
    expect(hydrationErrors).toEqual([])
  }
  await captureScreenshot(page, example, "initial")

  if (example.strategy === "cookie") {
    const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15_000 })
    await page
      .getByTestId("locale-switch-de")
      .click({ force: true, noWaitAfter: true, timeout: 15_000 })
    await navigation

    await expect
      .poll(() => page.locator("html").getAttribute("lang"))
      .toBe(documentLocale(example, "de"))
    await expect.poll(() => currentServerLocale(page)).toContain("Deutsch")

    await waitForClientReady(page)
    if (example.id === "nextjs-cookie") {
      await expect.poll(() => page.locator(".ticket .cta").textContent()).toBe("In den Warenkorb")
      await expect
        .poll(async () => (await page.locator("body").innerText()).includes("Add to cart"))
        .toBe(false)
    }
    await page.evaluate(() => {
      document.querySelector('[data-testid="server-proof-trigger"]')?.click()
    })
    await expect
      .poll(
        async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? ""
      )
      .toContain("de")
    if (example.id === "waku-cookie") {
      await expect
        .poll(() => page.getByTestId("server-proof-sync").textContent())
        .toBe("Synchroner Serveraktionshelfer bestätigte Sprache.")
      await expect
        .poll(() => page.getByTestId("server-proof-async").textContent())
        .toBe("Asynchroner Serveraktionshelfer bestätigte Sprache.")
      await expect
        .poll(() => page.getByTestId("server-proof-cross-module").textContent())
        .toBe("Modulübergreifender Serveraktionshelfer bestätigte Sprache.")
      await expect
        .poll(() => page.getByTestId("server-proof-default-parameter").textContent())
        .toBe("Parameterstandard bestätigte Sprache.")

      const englishContext = await browser.newContext({ locale: "en-US" })
      const englishPage = await englishContext.newPage()
      await englishPage.goto(`${example.baseUrl}/`, { waitUntil: "domcontentloaded" })
      await waitForClientReady(englishPage)
      await Promise.all([
        page.evaluate(() =>
          document.querySelector('[data-testid="server-proof-trigger"]')?.click()
        ),
        englishPage.evaluate(() =>
          document.querySelector('[data-testid="server-proof-trigger"]')?.click()
        ),
      ])
      await expect
        .poll(
          async () => (await page.getByTestId("server-proof-message").textContent())?.trim() ?? ""
        )
        .toContain("de")
      await expect
        .poll(
          async () =>
            (await englishPage.getByTestId("server-proof-message").textContent())?.trim() ?? ""
        )
        .toContain("en")
      await englishContext.close()
    }
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
