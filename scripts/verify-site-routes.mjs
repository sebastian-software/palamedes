/*
 * Headless click-through of the built site (site/build/client). Serves the
 * prerendered output, then crawls every sitemap route, asserts route-heading
 * contracts where they are stable, checks zero console errors, and exercises
 * important interactions. Runs three passes:
 * default, reduced-motion, and JS-disabled.
 *
 * Usage: node scripts/verify-site-routes.mjs  (requires a prior site build)
 */

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { chromium } from "@playwright/test"
import { startSiteStaticServer } from "./site-static-server.mjs"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
const clientDir = join(repoRoot, "site/build/client")
const PORT = 4102

/*
 * The ProofStrip speedup figure is read out of bench.ts rather than repeated
 * here. Hardcoding it meant this assertion silently drifted from the guarded
 * benchmark data (it was still asserting an old ratio long after the numbers
 * were refreshed), which is exactly the failure this script exists to catch.
 */
const linguiRatio = (() => {
  const benchTs = readFileSync(join(repoRoot, "site/app/data/bench.ts"), "utf8")
  const realistic = benchTs.slice(benchTs.indexOf("export const BENCH_REALISTIC"))
  const match = realistic.match(/lingui: "([\d.]+×)"/u)
  if (!match) throw new Error("verify-site-routes: cannot read BENCH_REALISTIC lingui ratio")
  return `${Math.floor(Number.parseFloat(match[1]))}×`
})()

const ROUTE_EXPECTATIONS = [
  // The homepage is verified through its real structural and interaction
  // checks below. Its marketing headline is intentionally not a test contract.
  { path: "/" },
  { path: "/frameworks", h1: "Six frameworks." },
  {
    path: "/frameworks/nextjs",
    h1: "Next.js i18n for the App Router, from server to client.",
  },
  {
    path: "/frameworks/tanstack-start",
    h1: "TanStack Start i18n for routes, server functions, and the client.",
  },
  {
    path: "/frameworks/solidstart",
    h1: "SolidStart i18n that stays native to Solid.",
  },
  {
    path: "/frameworks/waku",
    h1: "Waku i18n across React Server and Client Components.",
  },
  {
    path: "/frameworks/react-router",
    h1: "React Router i18n for Framework Mode.",
  },
  {
    path: "/frameworks/remix-v3",
    h1: "Remix v3 i18n for its new server-first stack.",
  },
  {
    path: "/frameworks/vite",
    h1: "Vite i18n for React and Solid, in one plugin.",
  },
  { path: "/proof", h1: "Claims you can re-run." },
  { path: "/get-started", h1: "The guided 5-minute path." },
  { path: "/compare", h1: "Compare it properly." },
  { path: "/compare/lingui", h1: "The same idea, on an engine" },
  { path: "/compare/i18next", h1: "You already know what the string says." },
  { path: "/compare/next-intl", h1: "frameworks wide." },
  { path: "/compare/react-intl", h1: "Keep the ICU rigor. Lose the provider." },
  { path: "/compare/paraglide", h1: "Smaller bundles. Bigger constraints." },
  { path: "/compare/tolgee", h1: "A runtime key, or the sentence itself." },
  {
    path: "/compare/intlayer",
    h1: "Write the dictionary, or write the sentence.",
  },
  { path: "/guides", h1: "The decisions that actually cost you time." },
  {
    path: "/react-server-components-i18n",
    h1: "i18n for React Server Components, without the workaround.",
  },
  {
    path: "/i18n-performance",
    h1: "Extraction should not be the slow part of your build.",
  },
  {
    path: "/icu-messageformat",
    h1: "'Supports ICU' is not a yes-or-no answer.",
  },
  { path: "/locale-routing", h1: "Four ways to carry a locale." },
  { path: "/blog", h1: "Building i18n tooling in the" },
  {
    path: "/blog/measuring-palamedes-honestly",
    h1: "Measuring Palamedes Honestly",
  },
  { path: "/docs", h1: "Documentation" },
  {
    path: "/docs/first-working-translation",
    h1: "First Working Translation",
  },
  { path: "/docs/platform-support", h1: "Platform Support" },
  { path: "/docs/cli", h1: "CLI Reference" },
  { path: "/docs/example-screenshots", h1: "Example Screenshots" },
  { path: "/decisions", h1: "Decision Records" },
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

const staticServer = await startSiteStaticServer({ clientDir, port: PORT })

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
  const knownHydrationWarnings = []

  if (!expectHydration) {
    for (const path of sitemapPaths) {
      const page = await context.newPage()
      trackPageErrors(page, () => path, consoleErrors, knownHydrationWarnings)
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
    trackPageErrors(routePage, () => route.path, consoleErrors, knownHydrationWarnings)
    await gotoAndSettle(routePage, route.path, { settleMs: 1500 })
    const h1 = await routePage.locator("h1").first().textContent()
    if (!h1?.trim()) {
      fail(`${label} ${route.path}: missing heading`)
    } else if (route.h1 && !h1.includes(route.h1)) {
      fail(`${label} ${route.path}: h1 mismatch, got "${h1}"`)
    } else {
      console.log(`  ok ${route.path} — "${h1.trim().slice(0, 48)}"`)
    }
    await routePage.close()
  }

  const page = await context.newPage()
  let currentPath = "(startup)"
  trackPageErrors(page, () => currentPath, consoleErrors, knownHydrationWarnings)

  if (expectHydration) {
    currentPath = "/"
    await gotoAndSettle(page, "/", { settleMs: 1500 })
    // The framework matrix (the second home table) renders all 24 cells.
    const cells = await page.locator("table").nth(1).locator("tbody td").count()
    if (cells !== 24) {
      fail(`home matrix: expected 24 cells, got ${cells}`)
    }
    // Homepage completion blocks: real routing destinations, a reproducible
    // benchmark command, and the six FAQ entries must remain present together.
    const integrationLinks = await page
      .locator('section[aria-label="First-party framework integrations"] li a')
      .count()
    if (integrationLinks !== 9) {
      fail(`home integration band: expected 9 linked entries, got ${integrationLinks}`)
    }
    const integrationLogos = page.locator(
      'section[aria-label="First-party framework integrations"] li img'
    )
    const logoCount = await integrationLogos.count()
    if (logoCount !== 9) {
      fail(`home integration band: expected 9 marks, got ${logoCount}`)
    } else {
      const unloadedLogos = await integrationLogos.evaluateAll((images) =>
        images.filter((image) => image.naturalWidth === 0).map((image) => image.getAttribute("src"))
      )
      if (unloadedLogos.length > 0) {
        fail(`home integration band: marks did not load: ${unloadedLogos.join(", ")}`)
      }
    }
    const questionRoutes = await page
      .locator(
        'a[href="/frameworks"], a[href="/locale-routing"], a[href="/proof"], a[href="/docs/migrate-from-lingui"], a[href="/compare"]'
      )
      .count()
    if (questionRoutes < 5) {
      fail(`home question routing: expected five decision routes, got ${questionRoutes}`)
    }
    const hierarchy = await page.evaluate(() => {
      const question = [...document.querySelectorAll("section")].find((section) =>
        section.textContent?.includes("Start from your question")
      )
      const proofStrip = document.querySelector(".hairline-grid")
      const integration = document.querySelector(
        'section[aria-label="First-party framework integrations"]'
      )
      return {
        questionAfterProof: Boolean(
          question &&
          proofStrip &&
          proofStrip.compareDocumentPosition(question) & Node.DOCUMENT_POSITION_FOLLOWING
        ),
        questionBeforeIntegration: Boolean(
          question &&
          integration &&
          question.compareDocumentPosition(integration) & Node.DOCUMENT_POSITION_FOLLOWING
        ),
      }
    })
    if (!hierarchy.questionAfterProof || !hierarchy.questionBeforeIntegration) {
      fail("home hierarchy: question routing must follow the proof strip and precede deep evidence")
    }
    // Comparison pages distinguish measured workflows from dated research.
    // The rival template leads with a verdict; the native-toolchain argument
    // belongs on the hub, not repeated on every rival page.
    const comparePage = await context.newPage()
    trackPageErrors(comparePage, () => "/compare", consoleErrors, knownHydrationWarnings)
    await gotoAndSettle(comparePage, "/compare", { settleMs: 1500 })
    const ledgerHeaders = await comparePage
      .locator("table")
      .first()
      .locator("thead th")
      .allTextContents()
    if (!ledgerHeaders.includes("Measured") || !ledgerHeaders.includes("Researched")) {
      fail("compare ledger: measured and researched columns missing")
    }
    const noClaim = await comparePage
      .getByText("Not measured — no claim implied.", { exact: true })
      .count()
    if (noClaim === 0) {
      fail("compare ledger: explicit no-claim cell missing")
    }
    const hubShift = await comparePage
      .getByRole("heading", {
        name: "The toolchain already moved. i18n tooling mostly hasn't.",
      })
      .count()
    if (hubShift !== 1) {
      fail("compare hub: native-toolchain explanation missing")
    }
    await gotoAndSettle(comparePage, "/compare/lingui", { settleMs: 1500 })
    const sectionNumbers = await comparePage.locator(".pmds-section-number").allTextContents()
    if (
      sectionNumbers[0]?.trim() !== "01 — Decide" ||
      sectionNumbers[1]?.trim() !== "02 — Lingui"
    ) {
      fail(`rival template: verdict must precede supporting detail (${sectionNumbers.join(", ")})`)
    }
    const repeatedShift = await comparePage
      .getByRole("heading", {
        name: "The toolchain already moved. i18n tooling mostly hasn't.",
      })
      .count()
    if (repeatedShift > 0 || sectionNumbers.some((section) => section.includes("Also weighing"))) {
      fail("rival template: repeated shift or obsolete section remains")
    }
    await comparePage.close()
    const benchmarkCommand = await page
      .getByText("$ pnpm benchmark:e2e-workflow", { exact: false })
      .isVisible()
    if (!benchmarkCommand) {
      fail("home benchmark: reproducible command missing")
    }
    const warmLaneCopy = await page
      .getByText(/cached re-run after 5 changed source files/u)
      .first()
      .isVisible()
    if (!warmLaneCopy) {
      fail("home benchmark: changed-source-files copy collapsed or missing")
    }
    const faqEntries = await page.locator("details").count()
    if (faqEntries !== 6) {
      fail(`home FAQ: expected 6 entries, got ${faqEntries}`)
    }
    const faqSchemaCount = await page.locator('script[type="application/ld+json"]').evaluateAll(
      (scripts) =>
        scripts
          .map((script) => JSON.parse(script.textContent ?? "{}"))
          .filter((entry) => entry["@type"] === "FAQPage")
          .flatMap((entry) => entry.mainEntity ?? []).length
    )
    if (faqSchemaCount !== 6) {
      fail(`home FAQ schema: expected 6 answers, got ${faqSchemaCount}`)
    }
    // Code showcase tabs toggle.
    await page.getByRole("tab", { name: "Translate" }).click()
    const poVisible = await page.getByText('msgid "Your trip to Lisbon"').isVisible()
    if (!poVisible) {
      fail("code showcase: Translate tab did not reveal .po pane")
    }
    // Get-started keeps the diagram, stack picker, and forward route as distinct
    // numbered sections. Each stack gives the package caveat its own numbered
    // step immediately after the install command.
    currentPath = "/get-started"
    await gotoAndSettle(page, "/get-started", { settleMs: 1500 })
    await checkGetStartedStructure(page, label)
    const reactTab = page.getByRole("tab", { name: "Vite + React" })
    const solidTab = page.getByRole("tab", { name: "Vite + Solid" })
    await reactTab.focus()
    await page.keyboard.press("ArrowRight")
    if (!(await solidTab.evaluate((element) => element === document.activeElement))) {
      fail(`get-started ${label}: ArrowRight did not focus the Solid stack tab`)
    }
    await page.keyboard.press("Enter")
    if ((await solidTab.getAttribute("aria-selected")) !== "true") {
      fail(`get-started ${label}: Enter did not select the focused Solid stack tab`)
    }
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
    await page.getByRole("banner").getByRole("link", { name: "Architecture", exact: true }).click()
    try {
      await page
        .getByRole("heading", { level: 1, name: "“Written in Rust” is the boring half." })
        .waitFor({ timeout: 5000 })
    } catch {
      fail("client-side navigation to /architecture failed")
    }

    // Regression for #863: generated docs must survive a marketing-to-docs
    // client transition as well as history navigation and reload. The issue
    // presented as a failed dynamic import followed by an invalid hook call in
    // ArdoPageDataProvider, both of which are captured by trackPageErrors.
    currentPath = "/"
    await gotoAndSettle(page, "/", { settleMs: 500 })
    await page.getByRole("banner").getByRole("link", { name: "Docs", exact: true }).click()
    currentPath = "/docs"
    await page.getByRole("heading", { level: 1, name: "Documentation" }).waitFor()
    await page.getByRole("link", { name: "First Working Translation" }).first().click()
    currentPath = "/docs/first-working-translation"
    await page.getByRole("heading", { level: 1, name: /First Working Translation/u }).waitFor()
    await page.goBack({ waitUntil: "networkidle" })
    currentPath = "/docs"
    await page.getByRole("heading", { level: 1, name: "Documentation" }).waitFor()
    await page.goForward({ waitUntil: "networkidle" })
    currentPath = "/docs/first-working-translation"
    await page.getByRole("heading", { level: 1, name: /First Working Translation/u }).waitFor()
    await page.reload({ waitUntil: "networkidle" })
    await page.getByRole("heading", { level: 1, name: /First Working Translation/u }).waitFor()
  } else {
    // No-JS completeness: the new proof strip and ledger must be static HTML.
    currentPath = "/"
    await gotoAndSettle(page, "/", { settleMs: 100 })
    const statText = await page.getByText("first-party server-framework integrations").isVisible()
    const stat = await page.getByText(linguiRatio, { exact: false }).first().isVisible()
    if (!statText || !stat) {
      fail("no-JS: proof-strip stats missing from prerendered HTML")
    }
    const ledger = await page.getByText("Checked result ledger", { exact: false }).isVisible()
    if (!ledger) {
      fail("no-JS: benchmark ledger missing from prerendered HTML")
    }
    const integrationBand = await page
      .getByRole("region", { name: "First-party framework integrations" })
      .isVisible()
    const questionRouting = await page
      .getByText("Which framework are you building with?")
      .isVisible()
    const faq = await page.getByText("Is Palamedes ready for production use?").isVisible()
    if (!integrationBand || !questionRouting || !faq) {
      fail("no-JS: homepage completion blocks missing from prerendered HTML")
    }
    currentPath = "/get-started"
    await gotoAndSettle(page, "/get-started", { settleMs: 100 })
    await checkGetStartedStructure(page, label)
  }

  if (consoleErrors.length > 0) {
    fail(`${label}: console errors: ${consoleErrors.slice(0, 3).join(" | ")}`)
  }
  if (knownHydrationWarnings.length > 0) {
    console.warn(
      `  known ARDO breadcrumb hydration warnings filtered: ${knownHydrationWarnings
        .slice(0, 5)
        .join(" | ")}`
    )
  }
  await page.close()
}

async function checkGetStartedStructure(page, label) {
  const sectionNumbers = (await page.locator(".pmds-section-number").allTextContents()).map(
    (text) => text.trim()
  )
  const expectedSections = ["01 — The loop", "02 — Choose a host", "03 — Next"]
  if (sectionNumbers.join("|") !== expectedSections.join("|")) {
    fail(`get-started ${label}: numbered sections drifted (${sectionNumbers.join(", ")})`)
  }

  const visiblePanel = page.getByRole("tabpanel").first()
  const listItems = visiblePanel.getByRole("listitem")
  const expectedSteps = [
    { number: "01", heading: "Install" },
    { number: "02", heading: "Use the scoped packages" },
    { number: "03", heading: "Configure" },
  ]
  for (const [index, expected] of expectedSteps.entries()) {
    const item = listItems.nth(index)
    const numberCount = await item.getByText(expected.number, { exact: true }).count()
    const headingCount = await item
      .getByRole("heading", { name: expected.heading, exact: true })
      .count()
    if (numberCount !== 1 || headingCount !== 1) {
      fail(
        `get-started ${label}: step ${index + 1} order drifted (number ${numberCount}, heading ${headingCount})`
      )
    }
  }
  const listItemCount = await listItems.count()
  if (listItemCount !== 7) {
    fail(`get-started ${label}: expected seven guided steps, got ${listItemCount}`)
  }
  if ((await listItems.nth(1).getByText("Package boundary", { exact: true }).count()) !== 1) {
    fail(`get-started ${label}: package boundary rail is missing from step 02`)
  }

  const loopHref = await page
    .getByRole("link", { name: "See the local loop", exact: true })
    .getAttribute("href")
  if (
    loopHref !== "#loop" ||
    (await page.locator("#loop").count()) !== 1 ||
    (await page.locator("#install").count()) !== 1
  ) {
    fail(`get-started ${label}: preserved loop/install anchors drifted`)
  }

  const frameworkHref = await page
    .getByRole("link", { name: "Choose your framework", exact: true })
    .getAttribute("href")
  const localeHref = await page
    .getByRole("link", { name: "Explore locale architecture", exact: true })
    .getAttribute("href")
  if (frameworkHref !== "/frameworks" || localeHref !== "/locale-routing") {
    fail(
      `get-started ${label}: closing CTA must move forward (${frameworkHref ?? "missing"}, ${localeHref ?? "missing"})`
    )
  }
}

async function checkGetStartedTextResize(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  })
  const page = await context.newPage()
  const response = await gotoAndSettle(page, "/get-started", { settleMs: 1500 })
  if (response?.status() !== 200) {
    fail(
      `get-started 390px/200% text: expected HTTP 200, got ${response?.status() ?? "no response"}`
    )
    await context.close()
    return
  }

  await page.addStyleTag({ content: ":root { font-size: 200% !important; }" })
  await page.waitForTimeout(100)

  const metrics = await page.evaluate(() => ({
    contentWidth: document.documentElement.scrollWidth,
    rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    tabLabels: [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim()),
    tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => {
      const rect = tab.getBoundingClientRect()
      return { height: rect.height, left: rect.left, right: rect.right, width: rect.width }
    }),
    viewportWidth: document.documentElement.clientWidth,
  }))

  if (metrics.rootFontSize !== 32) {
    fail(`get-started 390px/200% text: expected 32px root font, got ${metrics.rootFontSize}px`)
  }
  if (metrics.contentWidth > metrics.viewportWidth + 1) {
    fail(
      `get-started 390px/200% text: horizontal overflow ${metrics.contentWidth}px > ${metrics.viewportWidth}px`
    )
  }
  const expectedLabels = ["Vite + React", "Vite + Solid", "Next.js"]
  if (metrics.tabLabels.join("|") !== expectedLabels.join("|")) {
    fail(`get-started 390px/200% text: tab source order drifted (${metrics.tabLabels.join(", ")})`)
  }
  for (const [index, box] of metrics.tabs.entries()) {
    if (
      box.left < -1 ||
      box.right > metrics.viewportWidth + 1 ||
      box.width < 44 ||
      box.height < 44
    ) {
      fail(
        `get-started 390px/200% text: tab ${index + 1} is not viewport-contained and 44px reachable (${JSON.stringify(box)})`
      )
    }
  }

  const reactTab = page.getByRole("tab", { name: "Vite + React" })
  const solidTab = page.getByRole("tab", { name: "Vite + Solid" })
  const nextTab = page.getByRole("tab", { name: "Next.js" })
  await reactTab.focus()
  await page.keyboard.press("ArrowRight")
  if (!(await solidTab.evaluate((element) => element === document.activeElement))) {
    fail("get-started 390px/200% text: ArrowRight did not reach the Solid tab")
  }
  await page.keyboard.press("Enter")
  await page.keyboard.press("ArrowRight")
  if (!(await nextTab.evaluate((element) => element === document.activeElement))) {
    fail("get-started 390px/200% text: ArrowRight did not reach the wrapped Next.js tab")
  }
  const focusStyle = await nextTab.evaluate((element) => {
    const style = getComputedStyle(element)
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth }
  })
  if (focusStyle.outlineStyle === "none" || focusStyle.outlineWidth === "0px") {
    fail("get-started 390px/200% text: wrapped Next.js tab has no visible keyboard focus")
  }
  await page.keyboard.press("Enter")
  if ((await nextTab.getAttribute("aria-selected")) !== "true") {
    fail("get-started 390px/200% text: Enter did not select the wrapped Next.js tab")
  }
  if (!(await page.getByText("@palamedes/next-plugin").first().isVisible())) {
    fail("get-started 390px/200% text: wrapped Next.js tab did not reveal its panel")
  }

  console.log(
    `  get-started 390px/200% text: ${metrics.contentWidth}px content, all tabs keyboard-reachable`
  )
  await context.close()
}

async function checkHomepageDecisionViewport(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
  })
  const page = await context.newPage()
  const response = await gotoAndSettle(page, "/", { settleMs: 1500 })
  if (response?.status() !== 200) {
    fail(`home ${width}px: expected HTTP 200, got ${response?.status() ?? "no response"}`)
  } else {
    const metrics = await page.evaluate(() => {
      const question = [...document.querySelectorAll("section")].find((section) =>
        section.textContent?.includes("Start from your question")
      )
      const firstDecision = question?.querySelector('a[href="/frameworks"]')
      const absoluteTop = (element) =>
        Math.round(element.getBoundingClientRect().top + window.scrollY)

      return {
        pageHeight: document.documentElement.scrollHeight,
        firstDecisionTop: firstDecision ? absoluteTop(firstDecision) : null,
      }
    })
    if (metrics.firstDecisionTop === null || metrics.firstDecisionTop >= metrics.pageHeight * 0.2) {
      fail(`home ${width}px: first decision route is not within the first fifth of the page`)
    }
    console.log(
      `  homepage ${width}px: first decision at ${metrics.firstDecisionTop}px of ${metrics.pageHeight}px`
    )
  }
  await context.close()
}

function trackPageErrors(page, getPath, consoleErrors, knownHydrationWarnings) {
  page.on("pageerror", (error) => {
    const message = error.message
    const path = getPath()
    if (isKnownArdoBreadcrumbHydrationWarning(path, message)) {
      knownHydrationWarnings.push(path)
    } else {
      consoleErrors.push(`${path}: ${message}`)
    }
  })
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text()
      const path = getPath()
      if (isKnownArdoBreadcrumbHydrationWarning(path, text)) {
        knownHydrationWarnings.push(path)
      } else {
        consoleErrors.push(`${path}: ${text}`)
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
    isArdoGeneratedContentRoute(path) &&
    message.includes("Minified React error #418") &&
    message.includes("args[]=HTML")
  )
}

function isArdoGeneratedContentRoute(path) {
  return (
    path === "/docs" ||
    path.startsWith("/docs/") ||
    path === "/decisions" ||
    path.startsWith("/decisions/") ||
    path === "/api-reference" ||
    path.startsWith("/api-reference/") ||
    path.startsWith("/blog/")
  )
}

async function gotoAndSettle(page, path, { settleMs }) {
  const response = await page.goto(`${staticServer.baseUrl}${path}`)
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(settleMs)
  return response
}

await checkRoutes(await browser.newContext(), "default", {
  expectHydration: true,
})
await checkRoutes(await browser.newContext({ reducedMotion: "reduce" }), "reduced-motion", {
  expectHydration: true,
})
await checkRoutes(await browser.newContext({ javaScriptEnabled: false }), "no-js", {
  expectHydration: false,
})
await checkGetStartedTextResize(browser)
await checkHomepageDecisionViewport(browser, 320)
await checkHomepageDecisionViewport(browser, 390)

await browser.close()
await staticServer.close()

if (failures > 0) {
  console.error(`verify-site-routes: ${failures} failure(s)`)
  process.exit(1)
}
console.log("verify-site-routes: all checks passed")
