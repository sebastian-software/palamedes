/*
 * Headless click-through of the built site (site/build/client). Serves the
 * prerendered output, then crawls every sitemap route, asserts route-heading
 * contracts where they are stable, checks zero console errors, and exercises
 * important interactions. Runs three passes:
 * default, reduced-motion, and JS-disabled.
 *
 * Usage: node scripts/verify-site-routes.mjs  (requires a prior site build)
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { startSiteStaticServer } from "./site-static-server.mjs";
import { verifyFrameworkBenchmarks } from "../site/scripts/verify-framework-benchmarks.mjs";
import {
  isExpectedSkippedViewTransitionError,
  isKnownArdoBreadcrumbHydrationWarning,
} from "./verify-site-route-errors.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = join(repoRoot, "site/build/client");
const generatedDocsDir = join(repoRoot, "site/app/routes/docs");
function portFromEnv(name, fallback) {
  const configured = process.env[name];
  if (configured === undefined) return fallback;
  const port = Number(configured);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `${name} must be an integer between 1 and 65_535, got ${JSON.stringify(configured)}`,
    );
  }
  return port;
}

const PORT = portFromEnv("SITE_VERIFY_PORT", 4102);
const packageScripts = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).scripts;
const browserRuntimeReport = JSON.parse(
  readFileSync(join(repoRoot, "benchmarks/browser-runtime/results.json"), "utf8"),
);
const legacySolidRedirect = readFileSync(
  join(clientDir, "frameworks/solidstart/index.html"),
  "utf8",
);

function hasHtmlTagWithAttributes(html, tagName, expectedAttributes) {
  const tagPattern = new RegExp(`<${tagName}\\b([^>]*)/?>`, "giu");
  const attributePattern = /([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gu;

  return [...html.matchAll(tagPattern)].some((tagMatch) => {
    const attributes = new Map(
      [...tagMatch[1].matchAll(attributePattern)].map((attributeMatch) => [
        attributeMatch[1].toLowerCase(),
        attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4],
      ]),
    );

    return Object.entries(expectedAttributes).every(
      ([name, value]) => attributes.get(name.toLowerCase()) === value,
    );
  });
}

if (
  !hasHtmlTagWithAttributes(legacySolidRedirect, "link", {
    rel: "canonical",
    href: "https://palamedes.dev/frameworks/solid",
  }) ||
  !hasHtmlTagWithAttributes(legacySolidRedirect, "meta", {
    "http-equiv": "refresh",
    content: "0;url=/frameworks/solid",
  })
) {
  throw new Error(
    "verify-site-routes: legacy SolidStart page must redirect and canonicalize to /frameworks/solid",
  );
}

if (packageScripts["bench:e2e"] !== "pnpm benchmark:e2e-workflow") {
  throw new Error("verify-site-routes: pnpm bench:e2e must run the checked end-to-end workflow");
}

/*
 * The ProofStrip speedup figure is read out of bench.ts rather than repeated
 * here. Hardcoding it meant this assertion silently drifted from the guarded
 * benchmark data (it was still asserting an old ratio long after the numbers
 * were refreshed), which is exactly the failure this script exists to catch.
 */
const linguiRatio = (() => {
  const benchTs = readFileSync(join(repoRoot, "site/app/data/bench.ts"), "utf8");
  const realistic = benchTs.slice(benchTs.indexOf("export const BENCH_REALISTIC"));
  const match = realistic.match(/lingui: "([\d.]+×)"/u);
  if (!match) throw new Error("verify-site-routes: cannot read BENCH_REALISTIC lingui ratio");
  return `${Math.floor(Number.parseFloat(match[1]))}×`;
})();

const ROUTE_EXPECTATIONS = [
  // The homepage is verified through its real structural and interaction
  // checks below. Its marketing headline is intentionally not a test contract.
  { path: "/" },
  { path: "/message-splitting", h1: "Load the view. Load its messages." },
  { path: "/frameworks", h1: "Built for the framework you already use." },
  {
    path: "/frameworks/nextjs",
    h1: "Next.js i18n for the App Router, from server to client.",
  },
  {
    path: "/frameworks/tanstack-start",
    h1: "TanStack Start i18n for routes, server functions, and the client.",
  },
  {
    path: "/frameworks/solid",
    h1: "Solid i18n that stays native to Solid.",
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
    h1: "Remix i18n, from the request to the browser.",
  },
  {
    path: "/frameworks/vite",
    h1: "Vite i18n for React and Solid, in one plugin.",
  },
  { path: "/frameworks/vue", h1: "Vue i18n, directly in your components." },
  { path: "/frameworks/nuxt", h1: "The same Vue messages, from server to browser." },
  { path: "/frameworks/svelte", h1: "Svelte i18n, directly in your components." },
  { path: "/frameworks/sveltekit", h1: "The same Svelte messages, from server to browser." },
  { path: "/proof", h1: "Claims you can re-run." },
  { path: "/get-started", h1: "Your first working translation." },
  { path: "/compare", h1: "Choose the i18n model you can keep." },
  { path: "/compare/lingui", h1: "The same idea, on an engine" },
  { path: "/compare/fbtee", h1: "Grammar in JSX, or standards" },
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
  {
    path: "/docs/nextjs-first-run",
    h1: "First Working Translation with Next.js",
  },
  { path: "/docs/platform-support", h1: "Platform Support" },
  { path: "/docs/cli", h1: "CLI Reference" },
  { path: "/docs/rust-applications", h1: "Rust Applications (Experimental)" },
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
];

const IA_DISCOVERY_PATHS = [
  "/architecture",
  "/get-started",
  "/guides",
  "/react-server-components-i18n",
  "/i18n-performance",
  "/icu-messageformat",
  "/locale-routing",
];

const sitemapPaths = readSitemapPaths();
const missingDiscoveryPaths = IA_DISCOVERY_PATHS.filter((path) => !sitemapPaths.includes(path));
if (missingDiscoveryPaths.length > 0) {
  throw new Error(
    `verify-site-routes: sitemap is missing IA routes: ${missingDiscoveryPaths.join(", ")}`,
  );
}

const staticServer = process.env.PALAMEDES_SITE_URL
  ? null
  : await startSiteStaticServer({ clientDir, port: PORT });
const baseUrl = process.env.PALAMEDES_SITE_URL ?? staticServer.baseUrl;

if (
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE &&
  !existsSync(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE)
) {
  console.warn(
    `  !! PLAYWRIGHT_CHROMIUM_EXECUTABLE is set but does not exist: ${process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}`,
  );
}

const chromiumExecutable = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/opt/pw-browsers/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find((path) => path && existsSync(path));

const browser = await chromium.launch(
  chromiumExecutable ? { executablePath: chromiumExecutable } : undefined,
);
let failures = 0;

function fail(message) {
  failures += 1;
  console.error(`  !! ${message}`);
}

function readSitemapPaths() {
  const sitemapPath = join(clientDir, "sitemap.xml");
  if (!existsSync(sitemapPath)) {
    console.error(`missing ${sitemapPath}; run pnpm build:site first`);
    process.exit(1);
  }
  const sitemap = readFileSync(sitemapPath, "utf8");
  const paths = [...sitemap.matchAll(/<loc>https:\/\/palamedes\.dev([^<]+)<\/loc>/gu)]
    .map((match) => match[1])
    .filter((path) => path !== "/404");
  if (paths.length === 0) {
    console.error("sitemap.xml did not contain any palamedes.dev routes");
    process.exit(1);
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

async function checkRoutes(context, label, { expectHydration }) {
  console.log(`— pass: ${label}`);
  const consoleErrors = [];
  const knownHydrationWarnings = [];
  const skippedViewTransitions = [];

  if (!expectHydration) {
    for (const path of sitemapPaths) {
      const page = await context.newPage();
      trackPageErrors(
        page,
        () => path,
        consoleErrors,
        knownHydrationWarnings,
        skippedViewTransitions,
      );
      const response = await gotoAndSettle(page, path, { settleMs: 100 });
      if (response?.status() !== 200) {
        fail(`${label} ${path}: expected HTTP 200, got ${response?.status() ?? "no response"}`);
        await page.close();
        continue;
      }
      const bodyText = await page.locator("body").innerText();
      if (bodyText.trim().length === 0) {
        fail(`${label} ${path}: empty body`);
      }
      await page.close();
    }
    console.log(`  ok crawled ${sitemapPaths.length} sitemap routes`);
  }

  for (const route of ROUTE_EXPECTATIONS) {
    const routePage = await context.newPage();
    trackPageErrors(
      routePage,
      () => route.path,
      consoleErrors,
      knownHydrationWarnings,
      skippedViewTransitions,
    );
    await gotoAndSettle(routePage, route.path, { settleMs: 1500 });
    const h1 = await routePage.locator("h1").first().textContent();
    if (!h1?.trim()) {
      fail(`${label} ${route.path}: missing heading`);
    } else if (route.h1 && !h1.includes(route.h1)) {
      fail(`${label} ${route.path}: h1 mismatch, got "${h1}"`);
    } else {
      console.log(`  ok ${route.path} — "${h1.trim().slice(0, 48)}"`);
    }
    if (route.path === "/proof" || IA_DISCOVERY_PATHS.includes(route.path)) {
      const expectedUrl = `https://palamedes.dev${route.path}`;
      const metadata = await routePage.evaluate(() => ({
        canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
        ogImage: document.querySelector('meta[property="og:image"]')?.getAttribute("content"),
        ogTitle: document.querySelector('meta[property="og:title"]')?.getAttribute("content"),
        ogUrl: document.querySelector('meta[property="og:url"]')?.getAttribute("content"),
      }));
      if (metadata.canonical !== expectedUrl || metadata.ogUrl !== expectedUrl) {
        fail(`${label} ${route.path}: canonical/OG URL does not match ${expectedUrl}`);
      }
      if (!metadata.ogTitle || !metadata.ogImage?.startsWith("https://palamedes.dev/")) {
        fail(`${label} ${route.path}: Open Graph title or image is missing`);
      }
    }
    if (["/", "/frameworks", "/get-started", "/frameworks/remix-v3"].includes(route.path)) {
      const branding = await routePage.evaluate(() =>
        [
          document.body.textContent,
          document.title,
          document.querySelector('meta[name="description"]')?.content,
        ].join(" "),
      );
      if (/Remix v3/u.test(branding)) {
        fail(`${label} ${route.path}: framework branding must use Remix without a version suffix`);
      }
    }
    if (route.path === "/frameworks") {
      const remixRow = routePage.getByRole("row").filter({
        has: routePage.getByRole("link", { name: "Remix", exact: true }),
      });
      const cells = remixRow.locator("td");
      const linkCounts = await cells.evaluateAll((entries) =>
        entries.map((cell) => cell.querySelectorAll('a[href^="https://"]').length),
      );
      if (JSON.stringify(linkCounts) !== JSON.stringify([1, 4, 4, 4])) {
        fail(
          `${label} /frameworks: Remix must expose all four demos and thirteen locale links, got ${JSON.stringify(linkCounts)}`,
        );
      }
      if ((await remixRow.getByText(/host pending/u).count()) !== 0) {
        fail(`${label} /frameworks: the verified Remix demos must be marked live`);
      }
    }
    await routePage.close();
  }

  const proofPage = await context.newPage();
  trackPageErrors(
    proofPage,
    () => "/proof",
    consoleErrors,
    knownHydrationWarnings,
    skippedViewTransitions,
  );
  await gotoAndSettle(proofPage, "/proof", { settleMs: expectHydration ? 500 : 100 });
  await checkProofStructure(proofPage, label);
  if (expectHydration) {
    const performanceHref = await proofPage
      .getByRole("link", { name: "i18n performance", exact: true })
      .getAttribute("href");
    if (performanceHref !== "/i18n-performance") {
      fail(`proof ${label}: performance evidence link drifted (${performanceHref ?? "missing"})`);
    }
    await gotoAndSettle(proofPage, "/i18n-performance", { settleMs: 100 });
    await proofPage.goBack({ waitUntil: "networkidle" });
    await proofPage.getByRole("heading", { level: 1, name: "Claims you can re-run." }).waitFor();
    await checkProofStructure(proofPage, `${label} history return`);
    await proofPage.goForward({ waitUntil: "networkidle" });
    await proofPage
      .getByRole("heading", {
        level: 1,
        name: "Extraction should not be the slow part of your build.",
      })
      .waitFor();
  }
  await proofPage.close();

  const page = await context.newPage();
  let currentPath = "(startup)";
  trackPageErrors(
    page,
    () => currentPath,
    consoleErrors,
    knownHydrationWarnings,
    skippedViewTransitions,
  );

  if (expectHydration) {
    currentPath = "/";
    await gotoAndSettle(page, "/", { settleMs: 1500 });
    // Homepage completion blocks: real routing destinations, a reproducible
    // benchmark command, and the seven FAQ entries must remain present together.
    const integrationSection = page.getByRole("region", { name: "First-party integrations" });
    const integrationGroups = integrationSection.getByRole("list", {
      name: "Integration groups",
      exact: true,
    });
    const groupEntries = integrationGroups.locator(":scope > li");
    const groupNames = await groupEntries.getByRole("heading", { level: 3 }).allTextContents();
    const expectedGroups = {
      Frameworks: 7,
      "UI Libraries": 4,
      "Build Tools": 2,
      Backends: 2,
      CLI: 1,
      MDX: 1,
      Rust: 1,
    };
    if (groupNames.join("|") !== Object.keys(expectedGroups).join("|")) {
      fail(`home integration groups: expected seven peer groups, got ${groupNames.join(", ")}`);
    }
    for (const [name, expectedCount] of Object.entries(expectedGroups)) {
      const group = integrationSection.getByRole("list", { name, exact: true });
      if (
        !(await group.isVisible()) ||
        (await group.getByRole("listitem").count()) !== expectedCount
      ) {
        fail(`home integration groups: ${name} needs ${expectedCount} visible entries`);
      }
    }
    if ((await integrationSection.locator("details").count()) !== 0) {
      fail("home integration groups: the complete stripe must be visible without disclosures");
    }
    const frameworks = integrationSection.getByRole("list", { name: "Frameworks", exact: true });
    for (const [name, href] of [
      ["Next.js", "/frameworks/nextjs"],
      ["Nuxt", "/frameworks/nuxt"],
      ["SvelteKit", "/frameworks/sveltekit"],
      ["TanStack Start", "/frameworks/tanstack-start"],
      ["React Router", "/frameworks/react-router"],
      ["Waku", "/frameworks/waku"],
      ["Remix", "/frameworks/remix-v3"],
    ]) {
      const link = frameworks.getByRole("link", { name, exact: true });
      if (!(await link.isVisible()) || (await link.getAttribute("href")) !== href) {
        fail(`home framework support: ${name} needs a visible link to its own guide`);
      }
    }
    const libraries = integrationSection.getByRole("list", { name: "UI Libraries", exact: true });
    if (
      (await libraries.getByRole("link", { name: "Svelte", exact: true }).getAttribute("href")) !==
      "/frameworks/svelte"
    ) {
      fail(
        "home integration groups: Svelte must keep its UI-library guide separate from SvelteKit",
      );
    }
    for (const [selector, href] of [
      ["#cli-applications", "/docs/backend-servers#one-setup-for-every-build"],
      ["#mdx-applications", "/docs/mdx"],
      ["#rust-applications", "/docs/rust-applications"],
    ]) {
      const group = integrationSection.locator(selector);
      if (
        (await group.getByRole("link").count()) !== 2 ||
        (await group.locator(`a[href="${href}"]`).count()) !== 1
      ) {
        fail(`home integration groups: ${selector} needs a guide and working example`);
      }
    }
    const mdxDemo = integrationSection.getByRole("link", { name: "MDX live demo", exact: true });
    if ((await mdxDemo.getAttribute("href")) !== "https://vite-mdx.examples.palamedes.dev") {
      fail("home integration groups: MDX must link to its live handbook demo");
    }
    const heroStart = page
      .locator(".pmds-hero")
      .getByRole("link", { name: "Find your starting point" });
    await heroStart.click();
    if (
      (await heroStart.getAttribute("href")) !== "#applications" ||
      (await integrationSection.getAttribute("id")) !== "applications"
    ) {
      fail("home integration groups: the hero must lead to the common stripe");
    }
    await frameworks.getByRole("link", { name: "Next.js", exact: true }).focus();
    await page.keyboard.press("Tab");
    if (
      !(await frameworks
        .getByRole("link", { name: "Nuxt", exact: true })
        .evaluate((link) => link === document.activeElement))
    ) {
      fail("home framework support: keyboard navigation must follow the visible integration order");
    }
    for (const logo of await integrationSection.locator("li img").all()) {
      await logo.scrollIntoViewIfNeeded();
      await logo.evaluate((image) => image.decode());
    }
    const mdxLogo = integrationSection.locator('img[src="/framework-logos/mdx.svg"]');
    if (
      (await mdxLogo.count()) !== 1 ||
      !(await mdxLogo.evaluate((image) => image.naturalWidth > 0))
    ) {
      fail("home integration groups: the original MDX mark must load beside its visible name");
    }
    const decisionPaths = page.getByRole("list", { name: "Decision paths" });
    const questionRoutes = await decisionPaths.locator(":scope > li").count();
    if (questionRoutes !== 4) {
      fail(`home question routing: expected four first-level decisions, got ${questionRoutes}`);
    }
    const contextualRoutes = [
      "/frameworks#frontend-frameworks",
      "/frameworks#backend-integrations",
      "/docs/rust-applications",
      "/react-server-components-i18n",
      "/locale-routing",
      "/i18n-performance",
      "/icu-messageformat",
      "/architecture",
      "/proof",
      "/compare",
      "/get-started",
      "/docs/agent-skill",
      "/guides",
      "/docs/migrate-from-lingui",
      "/docs",
    ];
    const missingContextualRoutes = [];
    for (const href of contextualRoutes) {
      if ((await decisionPaths.locator(`a[href="${href}"]`).count()) === 0) {
        missingContextualRoutes.push(href);
      }
    }
    if (missingContextualRoutes.length > 0) {
      fail(
        `home question routing: missing contextual routes ${missingContextualRoutes.join(", ")}`,
      );
    }
    const hierarchy = await page.evaluate(() => {
      const paths = document.querySelector('[aria-label="Decision paths"]');
      const integration = document.querySelector('section[aria-label="First-party integrations"]');
      const hero = document.querySelector(".pmds-hero");
      const explainers = ["#journey", "#why-rust", "#frameworks"].map((selector) =>
        document.querySelector(selector),
      );
      const follows = (earlier, later) =>
        Boolean(
          earlier &&
          later &&
          earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      return {
        heroFirst:
          follows(hero, integration) && explainers.every((section) => follows(hero, section)),
        pathsAfterExplainers:
          follows(integration, paths) && explainers.every((section) => follows(section, paths)),
      };
    });
    if (!hierarchy.heroFirst || !hierarchy.pathsAfterExplainers) {
      fail("home hierarchy: explain the product and its evidence before deeper evaluation paths");
    }
    // Comparison pages distinguish measured workflows from dated research.
    // The rival template leads with a verdict; the native-toolchain argument
    // belongs on the hub, not repeated on every rival page.
    const comparePage = await context.newPage();
    trackPageErrors(
      comparePage,
      () => "/compare",
      consoleErrors,
      knownHydrationWarnings,
      skippedViewTransitions,
    );
    await gotoAndSettle(comparePage, "/compare", { settleMs: 1500 });
    const ledgerHeaders = await comparePage
      .locator("table")
      .first()
      .locator("thead th")
      .allTextContents();
    if (!ledgerHeaders.includes("Measured") || !ledgerHeaders.includes("Researched")) {
      fail("compare ledger: measured and researched columns missing");
    }
    const noClaim = await comparePage
      .getByText("Not measured — no claim implied.", { exact: true })
      .count();
    if (noClaim === 0) {
      fail("compare ledger: explicit no-claim cell missing");
    }
    const hubShift = await comparePage
      .getByRole("heading", {
        name: "The toolchain already moved. i18n tooling mostly hasn't.",
      })
      .count();
    if (hubShift !== 1) {
      fail("compare hub: native-toolchain explanation missing");
    }
    const rivalPaths = [
      "/compare/lingui",
      "/compare/fbtee",
      "/compare/i18next",
      "/compare/next-intl",
      "/compare/react-intl",
      "/compare/paraglide",
      "/compare/tolgee",
      "/compare/intlayer",
    ];
    for (const path of rivalPaths) {
      await gotoAndSettle(comparePage, path, { settleMs: 1500 });
      const sectionNumbers = await comparePage.locator(".pmds-section-number").allTextContents();
      if (
        sectionNumbers[0]?.trim() !== "01 — Decide" ||
        sectionNumbers[1]?.trim() !== "02 — Daily work"
      ) {
        fail(
          `${path}: decision and workflow outcomes must precede supporting detail (${sectionNumbers.join(", ")})`,
        );
      }
      if (
        (await comparePage.getByRole("heading", { name: /Pick Palamedes when/u }).count()) !== 1
      ) {
        fail(`${path}: missing Palamedes decision path`);
      }
      if ((await comparePage.locator("[data-faq-list] details").count()) !== 5) {
        fail(`${path}: expected five comparison-specific FAQs`);
      }
      const faqSchemaCount = await comparePage
        .locator('script[type="application/ld+json"]')
        .evaluateAll(
          (scripts) =>
            scripts
              .map((script) => JSON.parse(script.textContent ?? "{}"))
              .filter((entry) => entry["@type"] === "FAQPage")
              .flatMap((entry) => entry.mainEntity ?? []).length,
        );
      if (faqSchemaCount !== 5) {
        fail(`${path}: FAQ schema must match the five visible questions`);
      }
    }
    const repeatedShift = await comparePage
      .getByRole("heading", {
        name: "The toolchain already moved. i18n tooling mostly hasn't.",
      })
      .count();
    if (repeatedShift > 0) {
      fail("rival template: repeated shift or obsolete section remains");
    }
    await comparePage.close();
    const benchmarkCommand = await page
      .getByText("pnpm benchmark:e2e-workflow", { exact: true })
      .isVisible();
    if (!benchmarkCommand) {
      fail("home benchmark: reproducible command missing");
    }
    const localBenchmark = page.locator("#why-rust [data-local-benchmark]");
    const localWasOpen = (await localBenchmark.getAttribute("open")) !== null;
    if (!localWasOpen) await localBenchmark.locator("summary").click();
    const warmLaneCopy = await localBenchmark
      .getByText(/cached re-run after 5 changed source files/u)
      .first()
      .isVisible();
    if (!warmLaneCopy) {
      fail("home benchmark: changed-source-files copy collapsed or missing");
    }
    if (!localWasOpen) await localBenchmark.locator("summary").click();
    const homeCopy = await page.locator("main").textContent();
    if (/\b(?:beta|preview|experimental)\b/iu.test(homeCopy)) {
      fail(
        "home integration presentation: release-tier labels must stay in the integration references",
      );
    }
    const runtimeSection = page.locator("#browser-runtime");
    const runtimeRows = runtimeSection.locator("tbody tr");
    if ((await runtimeRows.count()) !== browserRuntimeReport.treeShakenProfiles.length) {
      fail("home browser footprint: every measured runtime profile must be present");
    }
    for (const [index, profile] of browserRuntimeReport.treeShakenProfiles.entries()) {
      const cells = await runtimeRows.nth(index).locator("td").allTextContents();
      const expected = [profile.bytes.gzip, profile.bytes.brotli].map(
        (bytes) => `${(bytes / 1000).toFixed(1)} kB`,
      );
      if (JSON.stringify(cells) !== JSON.stringify(expected)) {
        fail(`home browser footprint: ${profile.id} must match the retained byte report`);
      }
    }
    const runtimeScope = (await runtimeSection.textContent()).replaceAll(/\s+/gu, " ");
    const catalog = browserRuntimeReport.catalog;
    const catalogReceipt = `${catalog.messages} messages: ${(catalog.bytes.gzip / 1000).toFixed(1)} kB gzip, ${(catalog.bytes.brotli / 1000).toFixed(1)} kB Brotli`;
    if (!runtimeScope.includes(catalogReceipt)) {
      fail(
        "home browser footprint: catalog message count and bytes must match the retained report",
      );
    }
    if (
      !runtimeScope.includes("generated client bootstrap, and catalogs are excluded") ||
      !runtimeScope.includes("Client imports after tree-shaking") ||
      !runtimeScope.includes("actual application increase")
    ) {
      fail(
        "home browser footprint: exclusions and application-delta limits must accompany the numbers",
      );
    }
    const faqEntries = await page.locator("[data-faq-list] details").count();
    if (faqEntries !== 7) {
      fail(`home FAQ: expected 7 entries, got ${faqEntries}`);
    }
    const faqSchemaCount = await page.locator('script[type="application/ld+json"]').evaluateAll(
      (scripts) =>
        scripts
          .map((script) => JSON.parse(script.textContent ?? "{}"))
          .filter((entry) => entry["@type"] === "FAQPage")
          .flatMap((entry) => entry.mainEntity ?? []).length,
    );
    if (faqSchemaCount !== 7) {
      fail(`home FAQ schema: expected 7 answers, got ${faqSchemaCount}`);
    }
    // The tour's rendered card switches language, and its seat stepper selects
    // the plural form for that locale.
    await page.getByRole("button", { name: "DE (German)", exact: true }).click();
    const germanCard = page.locator('article[lang="de"]');
    if (!(await germanCard.getByText("Deine Reise beginnt morgen.").isVisible())) {
      fail("tour card: German did not switch the rendered card");
    }
    const fewerSeats = page.getByRole("button", { name: "One seat fewer" });
    await fewerSeats.click();
    await fewerSeats.click();
    if ((await germanCard.getByText("1 Platz frei").count()) !== 1) {
      fail("tour card: the seat stepper did not select the German singular form");
    }
    // The verified framework matrix on /frameworks renders all 40 cells.
    currentPath = "/frameworks";
    await gotoAndSettle(page, "/frameworks", { settleMs: 1000 });
    const cells = await page.locator("table").first().locator("tbody td").count();
    if (cells !== 40) {
      fail(`framework matrix: expected 40 cells, got ${cells}`);
    }
    // Get-started keeps the diagram, stack picker, and forward route as distinct
    // numbered sections. Each stack gives the package caveat its own numbered
    // step immediately after the install command.
    currentPath = "/get-started";
    await gotoAndSettle(page, "/get-started", { settleMs: 1500 });
    await checkGetStartedStructure(page, label);
    const reactTab = page.getByRole("tab", { name: "Vite + React" });
    const solidTab = page.getByRole("tab", { name: "Vite + Solid" });
    await reactTab.focus();
    await page.keyboard.press("ArrowRight");
    if (!(await solidTab.evaluate((element) => element === document.activeElement))) {
      fail(`get-started ${label}: ArrowRight did not focus the Solid stack tab`);
    }
    await page.keyboard.press("Enter");
    if ((await solidTab.getAttribute("aria-selected")) !== "true") {
      fail(`get-started ${label}: Enter did not select the focused Solid stack tab`);
    }
    const solidVisible = await page.getByText("@solidjs/vite-plugin").first().isVisible();
    if (!solidVisible) {
      fail("get-started: Solid tab did not reveal Solid setup");
    }
    await page.getByRole("tab", { name: "Next.js" }).click();
    const nextVisible = await page.getByText("@palamedes/next-plugin").first().isVisible();
    if (!nextVisible) {
      fail("get-started: Next.js tab did not reveal Next setup");
    }
    // Client-side nav via the top navigation. With viewTransition the URL
    // updates before the render commits, so wait for the target heading.
    await page.getByRole("banner").getByRole("link", { name: "Architecture", exact: true }).click();
    try {
      await page
        .getByRole("heading", { level: 1, name: "One model, from your code to every runtime." })
        .waitFor({ timeout: 5000 });
    } catch {
      fail("client-side navigation to /architecture failed");
    }

    // Regression for #863: generated docs must survive a marketing-to-docs
    // client transition as well as history navigation and reload. The issue
    // presented as a failed dynamic import followed by an invalid hook call in
    // ArdoPageDataProvider, both of which are captured by trackPageErrors.
    currentPath = "/";
    await gotoAndSettle(page, "/", { settleMs: 500 });
    await page.getByRole("banner").getByRole("link", { name: "Docs", exact: true }).click();
    currentPath = "/docs";
    await page.getByRole("heading", { level: 1, name: "Documentation" }).waitFor();
    await page.getByRole("link", { name: "First Working Translation" }).first().click();
    currentPath = "/docs/first-working-translation";
    await page.getByRole("heading", { level: 1, name: /First Working Translation/u }).waitFor();
    await page.goBack({ waitUntil: "networkidle" });
    currentPath = "/docs";
    await page.getByRole("heading", { level: 1, name: "Documentation" }).waitFor();
    await page.goForward({ waitUntil: "networkidle" });
    currentPath = "/docs/first-working-translation";
    await page.getByRole("heading", { level: 1, name: /First Working Translation/u }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { level: 1, name: /First Working Translation/u }).waitFor();

    // The guide hub remains the active resource for direct topic entry and
    // browser history, while search still reaches the generated docs index.
    currentPath = "/icu-messageformat";
    await gotoAndSettle(page, "/icu-messageformat", { settleMs: 500 });
    const guidesNavigation = page
      .getByRole("banner")
      .getByRole("link", { name: "Guides", exact: true });
    if ((await guidesNavigation.getAttribute("aria-current")) !== "page") {
      fail("topic navigation: Guides is not exposed as the current resource");
    }
    await guidesNavigation.click();
    currentPath = "/guides";
    await page.getByRole("heading", { level: 1, name: /decisions that actually cost/u }).waitFor();
    await page.locator('a[href="/react-server-components-i18n"]').first().click();
    currentPath = "/react-server-components-i18n";
    await page.getByRole("heading", { level: 1, name: /React Server Components/u }).waitFor();
    await page.goBack({ waitUntil: "networkidle" });
    currentPath = "/guides";
    await page.getByRole("heading", { level: 1, name: /decisions that actually cost/u }).waitFor();
    await page.goForward({ waitUntil: "networkidle" });
    currentPath = "/react-server-components-i18n";
    await page.getByRole("heading", { level: 1, name: /React Server Components/u }).waitFor();

    currentPath = "/";
    await gotoAndSettle(page, "/", { settleMs: 500 });
    const search = page.getByRole("combobox", { name: "Search" });
    await search.fill("First Working Translation");
    const searchResults = page.getByRole("listbox", { name: "Search results" });
    if ((await searchResults.getByRole("option").count()) === 0) {
      fail("header search: expected a result for First Working Translation");
    }
  } else {
    // No-JS completeness: the new proof strip and ledger must be static HTML.
    currentPath = "/";
    await gotoAndSettle(page, "/", { settleMs: 100 });
    const statText = await page
      .getByText("example applications, built and smoke-checked in the production image")
      .isVisible();
    const stat = await page.getByText(linguiRatio, { exact: false }).first().isVisible();
    if (!statText || !stat) {
      fail("no-JS: proof figures and benchmark factors missing from prerendered HTML");
    }
    const localRecording = page.locator("#why-rust [data-local-benchmark]");
    const recordingWasOpen = (await localRecording.getAttribute("open")) !== null;
    if (!recordingWasOpen) await localRecording.locator("summary").click();
    const ledger = await page
      .getByRole("table", { name: /Extract and catalog update/u })
      .isVisible();
    if (!recordingWasOpen) await localRecording.locator("summary").click();
    const referenceLedger = await page.locator("#platform-benchmarks table").isVisible();
    if (!ledger || !referenceLedger) {
      fail("no-JS: reference table or native benchmark recording is inaccessible");
    }
    const integrationBand = await page
      .getByRole("region", { name: "First-party integrations" })
      .isVisible();
    const groupNames = await page
      .getByRole("list", { name: "Integration groups", exact: true })
      .getByRole("heading", { level: 3 })
      .allTextContents();
    if (groupNames.join("|") !== "Frameworks|UI Libraries|Build Tools|Backends|CLI|MDX|Rust") {
      fail("no-JS: all seven integration groups must be present in prerendered HTML");
    }
    const frameworks = page.getByRole("list", { name: "Frameworks", exact: true });
    if (
      !(await frameworks.getByRole("link", { name: "Next.js", exact: true }).isVisible()) ||
      (await page.locator("#applications details").count()) !== 0
    ) {
      fail("no-JS: the technology stripe and framework names must be visible without disclosures");
    }
    const questionRouting = await page.getByText("Starting a new project?").isVisible();
    const faq = await page.getByText("Is Palamedes ready for production use?").isVisible();
    if (!integrationBand || !questionRouting || !faq) {
      fail("no-JS: homepage completion blocks missing from prerendered HTML");
    }
    const firstLevelNavigation = await page
      .getByRole("banner")
      .getByRole("navigation")
      .getByRole("link")
      .allTextContents();
    if (firstLevelNavigation.join("|") !== "Frameworks|Architecture|Guides|Docs") {
      fail(`no-JS: first-level navigation drifted (${firstLevelNavigation.join(", ")})`);
    }
    currentPath = "/get-started";
    await gotoAndSettle(page, "/get-started", { settleMs: 100 });
    await checkGetStartedStructure(page, label);
    currentPath = "/guides";
    await gotoAndSettle(page, "/guides", { settleMs: 100 });
    const guideTopicLinks = await page
      .locator(
        'a[href="/react-server-components-i18n"], a[href="/i18n-performance"], a[href="/icu-messageformat"], a[href="/locale-routing"]',
      )
      .count();
    if (guideTopicLinks !== 4) {
      fail(`no-JS: guides hub expected four topic links, got ${guideTopicLinks}`);
    }
  }

  if (consoleErrors.length > 0) {
    fail(`${label}: console errors: ${consoleErrors.slice(0, 3).join(" | ")}`);
  }
  if (knownHydrationWarnings.length > 0) {
    console.warn(
      `  known ARDO breadcrumb hydration warnings filtered: ${knownHydrationWarnings
        .slice(0, 5)
        .join(" | ")}`,
    );
  }
  if (skippedViewTransitions.length > 0) {
    console.warn(
      `  known skipped View Transition page errors filtered: ${skippedViewTransitions
        .slice(0, 5)
        .join(" | ")}`,
    );
  }
  await page.close();
}

async function checkProofStructure(page, label) {
  const command = page.getByText("pnpm bench:e2e", { exact: true });
  if ((await command.count()) !== 2) {
    fail(`proof ${label}: expected the short re-run command in the hero and honest note`);
  }

  const corpusLedger = page.getByRole("region", {
    name: "Cold, warm, and same-scope benchmark summary",
  });
  const headers = (await corpusLedger.getByRole("columnheader").allTextContents()).map((text) =>
    text.trim(),
  );
  const expectedHeaders = ["Corpus", "Palamedes cold", "Palamedes warm", "Same-scope tools"];
  if (!expectedHeaders.every((header, index) => headers[index]?.startsWith(header))) {
    fail(`proof ${label}: corpus ledger columns drifted (${headers.join(", ")})`);
  }
  if ((await corpusLedger.getByRole("row").count()) !== 4) {
    fail(`proof ${label}: expected one header and three corpus rows`);
  }
  const environmentHeader = await page
    .getByText(/Node v\d+\.\d+\.\d+ · \S+\/\S+ · median of \d+/u)
    .count();
  if (environmentHeader !== 1) {
    fail(`proof ${label}: BENCH_META environment header missing or duplicated`);
  }

  const decisionLedger = page.getByRole("region", { name: "Architecture decision ledger" });
  const decisionHeadings = (
    await decisionLedger.locator(":scope > div").first().locator("span").allTextContents()
  )
    .join(" ")
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (decisionHeadings !== "No. Decision Status") {
    fail(`proof ${label}: decision ledger headings drifted (${decisionHeadings})`);
  }
  if ((await decisionLedger.locator("ol > li").count()) === 0) {
    fail(`proof ${label}: decision ledger has no numbered records`);
  }

  const emphasisRails = page.locator(".pmds-editorial-rail--emphasis");
  if (
    (await emphasisRails.count()) !== 2 ||
    (await emphasisRails.getByText("Honest note", { exact: true }).count()) !== 1 ||
    (await emphasisRails.getByText("Exact boundary", { exact: true }).count()) !== 1
  ) {
    fail(`proof ${label}: honest-note or exact-boundary editorial rail drifted`);
  }
  if ((await page.getByText(/5[- ]minute/u).count()) > 0) {
    fail(`proof ${label}: completion-time promise returned`);
  }
}

async function checkGetStartedStructure(page, label) {
  const sectionNumbers = (await page.locator(".pmds-section-number").allTextContents()).map(
    (text) => text.trim(),
  );
  const expectedSections = ["01 — The loop", "02 — Choose a host", "03 — Next"];
  if (sectionNumbers.join("|") !== expectedSections.join("|")) {
    fail(`get-started ${label}: numbered sections drifted (${sectionNumbers.join(", ")})`);
  }

  const visiblePanel = page.getByRole("tabpanel").first();
  const listItems = visiblePanel.getByRole("listitem");
  const expectedSteps = [
    { number: "01", heading: "Install" },
    { number: "02", heading: "Use the scoped packages" },
    { number: "03", heading: "Configure" },
  ];
  for (const [index, expected] of expectedSteps.entries()) {
    const item = listItems.nth(index);
    const numberCount = await item.getByText(expected.number, { exact: true }).count();
    const headingCount = await item
      .getByRole("heading", { name: expected.heading, exact: true })
      .count();
    if (numberCount !== 1 || headingCount !== 1) {
      fail(
        `get-started ${label}: step ${index + 1} order drifted (number ${numberCount}, heading ${headingCount})`,
      );
    }
  }
  const listItemCount = await listItems.count();
  if (listItemCount !== 7) {
    fail(`get-started ${label}: expected seven guided steps, got ${listItemCount}`);
  }
  if ((await listItems.nth(1).getByText("Package boundary", { exact: true }).count()) !== 1) {
    fail(`get-started ${label}: package boundary rail is missing from step 02`);
  }

  const frameworkHrefs = await page
    .getByRole("link", { name: "Choose your framework", exact: true })
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  if (
    !frameworkHrefs.includes("#install") ||
    (await page.locator("#loop").count()) !== 1 ||
    (await page.locator("#install").count()) !== 1
  ) {
    fail(`get-started ${label}: manual setup must reach the preserved install anchor`);
  }

  const skillHref = await page
    .getByRole("link", { name: "Set up with your agent", exact: true })
    .getAttribute("href");
  const localeHref = await page
    .getByRole("link", { name: "Explore locale architecture", exact: true })
    .getAttribute("href");
  if (
    !frameworkHrefs.includes("/frameworks") ||
    localeHref !== "/locale-routing" ||
    skillHref !== "/docs/agent-skill"
  ) {
    fail(`get-started ${label}: framework, locale, or agent setup route is missing`);
  }
}

async function checkGetStartedTextResize(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const response = await gotoAndSettle(page, "/get-started", { settleMs: 1500 });
  if (response?.status() !== 200) {
    fail(
      `get-started 390px/200% text: expected HTTP 200, got ${response?.status() ?? "no response"}`,
    );
    await context.close();
    return;
  }

  await page.addStyleTag({ content: ":root { font-size: 200% !important; }" });
  await page.waitForTimeout(100);

  const metrics = await page.evaluate(() => ({
    contentWidth: document.documentElement.scrollWidth,
    rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    tabLabels: [...document.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim()),
    tabs: [...document.querySelectorAll('[role="tab"]')].map((tab) => {
      const rect = tab.getBoundingClientRect();
      return { height: rect.height, left: rect.left, right: rect.right, width: rect.width };
    }),
    viewportWidth: document.documentElement.clientWidth,
  }));

  if (metrics.rootFontSize !== 32) {
    fail(`get-started 390px/200% text: expected 32px root font, got ${metrics.rootFontSize}px`);
  }
  if (metrics.contentWidth > metrics.viewportWidth + 1) {
    fail(
      `get-started 390px/200% text: horizontal overflow ${metrics.contentWidth}px > ${metrics.viewportWidth}px`,
    );
  }
  const expectedLabels = ["Vite + React", "Vite + Solid", "Next.js"];
  if (metrics.tabLabels.join("|") !== expectedLabels.join("|")) {
    fail(`get-started 390px/200% text: tab source order drifted (${metrics.tabLabels.join(", ")})`);
  }
  for (const [index, box] of metrics.tabs.entries()) {
    if (
      box.left < -1 ||
      box.right > metrics.viewportWidth + 1 ||
      box.width < 44 ||
      box.height < 44
    ) {
      fail(
        `get-started 390px/200% text: tab ${index + 1} is not viewport-contained and 44px reachable (${JSON.stringify(box)})`,
      );
    }
  }

  const reactTab = page.getByRole("tab", { name: "Vite + React" });
  const solidTab = page.getByRole("tab", { name: "Vite + Solid" });
  const nextTab = page.getByRole("tab", { name: "Next.js" });
  await reactTab.focus();
  await page.keyboard.press("ArrowRight");
  if (!(await solidTab.evaluate((element) => element === document.activeElement))) {
    fail("get-started 390px/200% text: ArrowRight did not reach the Solid tab");
  }
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  if (!(await nextTab.evaluate((element) => element === document.activeElement))) {
    fail("get-started 390px/200% text: ArrowRight did not reach the wrapped Next.js tab");
  }
  const focusStyle = await nextTab.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  if (focusStyle.outlineStyle === "none" || focusStyle.outlineWidth === "0px") {
    fail("get-started 390px/200% text: wrapped Next.js tab has no visible keyboard focus");
  }
  await page.keyboard.press("Enter");
  if ((await nextTab.getAttribute("aria-selected")) !== "true") {
    fail("get-started 390px/200% text: Enter did not select the wrapped Next.js tab");
  }
  if (!(await page.getByText("@palamedes/next-plugin").first().isVisible())) {
    fail("get-started 390px/200% text: wrapped Next.js tab did not reveal its panel");
  }

  console.log(
    `  get-started 390px/200% text: ${metrics.contentWidth}px content, all tabs keyboard-reachable`,
  );
  await context.close();
}

async function checkProofViewport(browser, width, { textScale = 1 } = {}) {
  const label = `proof ${width}px${textScale === 2 ? "/200% text" : ""}`;
  const context = await browser.newContext({ viewport: { width, height: 844 } });
  const page = await context.newPage();
  const response = await gotoAndSettle(page, "/proof", { settleMs: 500 });
  if (response?.status() !== 200) {
    fail(`${label}: expected HTTP 200, got ${response?.status() ?? "no response"}`);
    await context.close();
    return;
  }
  if (textScale === 2) {
    await page.addStyleTag({ content: ":root { font-size: 200% !important; }" });
    await page.waitForTimeout(100);
  }

  const copyButton = page.getByRole("button", { name: "Copy command: pnpm bench:e2e" });
  const corpusLedger = page.getByRole("region", {
    name: "Cold, warm, and same-scope benchmark summary",
  });
  const metrics = await page.evaluate(() => ({
    contentWidth: document.documentElement.scrollWidth,
    rootFontSize: Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    viewportWidth: document.documentElement.clientWidth,
  }));
  if (metrics.contentWidth > metrics.viewportWidth + 1) {
    fail(`${label}: horizontal overflow ${metrics.contentWidth}px > ${metrics.viewportWidth}px`);
  }
  if (textScale === 2 && metrics.rootFontSize !== 32) {
    fail(`${label}: expected 32px root font, got ${metrics.rootFontSize}px`);
  }

  const copyBox = await copyButton.boundingBox();
  if (!copyBox || copyBox.height < 44 || copyBox.x < -1 || copyBox.x + copyBox.width > width + 1) {
    fail(`${label}: copy control is not viewport-contained and at least 44px tall`);
  }
  const ledgerMetrics = await corpusLedger.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  if (ledgerMetrics.scrollWidth <= ledgerMetrics.clientWidth) {
    fail(`${label}: wide corpus ledger is not exposed as a local scroll region`);
  }
  await corpusLedger.focus();
  const initialScroll = await corpusLedger.evaluate((element) => element.scrollLeft);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(100);
  if ((await corpusLedger.evaluate((element) => element.scrollLeft)) <= initialScroll) {
    fail(`${label}: keyboard did not scroll the focused corpus ledger`);
  }

  console.log(`  ${label}: responsive ledger and copy control passed`);
  await context.close();
}

async function checkHomepageSetupViewport(browser, width) {
  const context = await browser.newContext({
    viewport: { width, height: 844 },
  });
  const page = await context.newPage();
  const response = await gotoAndSettle(page, "/", { settleMs: 1500 });
  if (response?.status() !== 200) {
    fail(`home ${width}px: expected HTTP 200, got ${response?.status() ?? "no response"}`);
  } else {
    const metrics = await page.evaluate(() => {
      const setup = document.querySelector('.pmds-hero a[href="#applications"]');
      const guides = [...document.querySelectorAll('[aria-label="Integration groups"] > li')].map(
        (entry) => entry.querySelector("a"),
      );

      return {
        pageHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
        setupBottom: setup ? Math.round(setup.getBoundingClientRect().bottom) : null,
        guideBottoms: guides.map((guide) =>
          guide ? Math.round(guide.getBoundingClientRect().bottom + window.scrollY) : null,
        ),
      };
    });
    if (metrics.setupBottom === null || metrics.setupBottom > metrics.viewportHeight) {
      fail(`home ${width}px: the primary integration action is outside the first viewport`);
    }
    if (
      metrics.guideBottoms.length !== 7 ||
      metrics.guideBottoms.some((bottom) => bottom === null || bottom >= metrics.pageHeight * 0.2)
    ) {
      fail(
        `home ${width}px: all seven integration groups must be within the first fifth of the page`,
      );
    }
    console.log(
      `  homepage ${width}px: integration action visible at ${metrics.setupBottom}px; all guides by ${Math.max(...metrics.guideBottoms)}px`,
    );
  }
  await context.close();
}

async function checkProgressiveDocsOutline(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await gotoAndSettle(page, "/docs/configuration", { settleMs: 1000 });

  const outline = page.locator(".pmds-progressive-outline");
  if ((await outline.count()) !== 1) {
    fail("progressive docs outline: missing on a long direct-entry page");
  } else {
    const links = outline.locator('a[href^="#"]');
    if ((await links.count()) !== 12) {
      fail(`progressive docs outline: expected 12 anchor links, got ${await links.count()}`);
    }
    const details = outline.locator("details");
    if (await details.evaluate((element) => element.hasAttribute("open"))) {
      fail("progressive docs outline: additional sections must start collapsed");
    }
    const summary = details.locator("summary");
    await summary.focus();
    await page.keyboard.press("Enter");
    if (!(await details.evaluate((element) => element.hasAttribute("open")))) {
      fail("progressive docs outline: keyboard did not open additional sections");
    }
    const target = details.getByRole("link", { name: "Other Data Formats", exact: true });
    await target.click();
    if (new URL(page.url()).hash !== "#other-data-formats") {
      fail("progressive docs outline: a disclosed anchor did not update the URL");
    }
  }
  await context.close();

  const noJsContext = await browser.newContext({ javaScriptEnabled: false });
  const noJsPage = await noJsContext.newPage();
  await gotoAndSettle(noJsPage, "/docs/configuration", { settleMs: 100 });
  const noJsOutline = noJsPage.locator(".pmds-progressive-outline");
  if (
    (await noJsOutline.count()) !== 1 ||
    (await noJsOutline.locator('a[href^="#"]').count()) !== 12
  ) {
    fail("progressive docs outline: direct no-JS entry lost its anchors");
  }
  await noJsContext.close();
}

async function checkProgressiveOutlineAnchors(browser) {
  const docs = readdirSync(generatedDocsDir, { recursive: true })
    .filter((entry) => /\.mdx?$/u.test(entry))
    .map((entry) => ({
      entry,
      source: readFileSync(join(generatedDocsDir, entry), "utf8"),
    }))
    .filter(({ source }) => source.includes('className="pmds-progressive-outline"'));

  if (docs.length !== 30) {
    fail(`progressive docs outline: expected 30 generated long docs, got ${docs.length}`);
  }
  if (!docs.some(({ entry }) => entry.replaceAll("\\", "/") === "api/vite-plugin/index.md")) {
    fail(
      "progressive docs outline: Vite component integration guide is missing its generated outline",
    );
  }
  if (!docs.some(({ entry }) => entry.replaceAll("\\", "/") === "api/remix/index.md")) {
    fail("progressive docs outline: Remix API guide is missing its generated outline");
  }

  if (!docs.some(({ entry }) => entry.replaceAll("\\", "/") === "rust-applications.mdx")) {
    fail("progressive docs outline: Rust application guide is missing its generated outline");
  }

  if (!docs.some(({ entry }) => entry.replaceAll("\\", "/") === "migration-v2.mdx")) {
    fail("progressive docs outline: v2 migration guide is missing its generated outline");
  }

  const context = await browser.newContext();
  const page = await context.newPage();
  for (const { entry, source } of docs) {
    const routeEntry = entry
      .replaceAll("\\", "/")
      .replace(/\.mdx?$/u, "")
      .replace(/\/index$/u, "");
    const path = `/docs/${routeEntry}`;
    const expectedIds = [...source.matchAll(/<a href="#([^"#]+)"/gu)].map((match) => match[1]);
    await gotoAndSettle(page, path, { settleMs: 200 });
    const missingIds = await page.evaluate(
      (ids) => ids.filter((id) => document.getElementById(id) == null),
      expectedIds,
    );
    if (missingIds.length > 0) {
      fail(
        `progressive docs outline: ${path} links to missing heading IDs: ${missingIds.join(", ")}`,
      );
    }
  }
  console.log(`  progressive outline heading IDs verified across ${docs.length} generated docs`);
  await context.close();
}

function trackPageErrors(
  page,
  getPath,
  consoleErrors,
  knownHydrationWarnings,
  skippedViewTransitions,
) {
  page.on("pageerror", (error) => {
    const message = error.message;
    const path = getPath();
    if (isExpectedSkippedViewTransitionError("pageerror", error)) {
      skippedViewTransitions.push(path);
    } else if (isKnownArdoBreadcrumbHydrationWarning(path, message)) {
      knownHydrationWarnings.push(path);
    } else {
      consoleErrors.push(`${path}: ${message}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      const text = message.text();
      const path = getPath();
      if (isKnownArdoBreadcrumbHydrationWarning(path, text)) {
        knownHydrationWarnings.push(path);
      } else {
        consoleErrors.push(`${path}: ${text}`);
      }
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      consoleErrors.push(`${getPath()}: HTTP ${response.status()} ${response.url()}`);
    }
  });
}

async function gotoAndSettle(page, path, { settleMs }) {
  const response = await page.goto(`${baseUrl}${path}`);
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(settleMs);
  return response;
}

async function checkDecisionRedirects() {
  const redirects = JSON.parse(
    readFileSync(join(repoRoot, "site/decision-redirects.json"), "utf8"),
  );
  const context = await browser.newContext();
  try {
    for (const [source, target] of Object.entries(redirects)) {
      const response = await context.request.get(`${baseUrl}/decisions/${source}/`);
      const html = await response.text();
      if (
        response.status() !== 200 ||
        !html.includes(`content="0;url=/decisions/${target}"`) ||
        !html.includes(`rel="canonical" href="https://palamedes.dev/decisions/${target}"`)
      ) {
        fail(`decision redirect: ${source} must lead directly to ${target}`);
      }
    }
  } finally {
    await context.close();
  }

  const [source, target] = Object.entries(redirects)[0];
  for (const javaScriptEnabled of [true, false]) {
    const redirectContext = await browser.newContext({ javaScriptEnabled });
    try {
      const page = await redirectContext.newPage();
      await page.goto(`${baseUrl}/decisions/${source}/`);
      await page.waitForURL(`${baseUrl}/decisions/${target}`);
      const heading = await page.locator("h1").first().textContent();
      if (!heading?.startsWith(`ADR-${target.slice(0, 3)}:`)) {
        fail(`decision redirect: wrong destination heading with JavaScript ${javaScriptEnabled}`);
      }
    } finally {
      await redirectContext.close();
    }
  }
  console.log(
    `  ${Object.keys(redirects).length} decision redirects verified; JS and no-JS navigation passed`,
  );
}

await checkDecisionRedirects();
await verifyFrameworkBenchmarks(browser, baseUrl, repoRoot);
await checkRoutes(await browser.newContext(), "default", {
  expectHydration: true,
});
await checkRoutes(await browser.newContext({ reducedMotion: "reduce" }), "reduced-motion", {
  expectHydration: true,
});
await checkRoutes(await browser.newContext({ javaScriptEnabled: false }), "no-js", {
  expectHydration: false,
});
await checkGetStartedTextResize(browser);
await checkProofViewport(browser, 320);
await checkProofViewport(browser, 390);
await checkProofViewport(browser, 430);
await checkProofViewport(browser, 390, { textScale: 2 });
await checkHomepageSetupViewport(browser, 320);
await checkHomepageSetupViewport(browser, 390);
await checkProgressiveDocsOutline(browser);
await checkProgressiveOutlineAnchors(browser);

await browser.close();
await staticServer?.close();

if (failures > 0) {
  console.error(`verify-site-routes: ${failures} failure(s)`);
  process.exit(1);
}
console.log("verify-site-routes: all checks passed");
