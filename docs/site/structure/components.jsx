/**
 * Pseudo-JSX component inventory for the Palamedes site.
 *
 * This file is a SPECIFICATION, not runnable code. Each component defines the
 * layout anatomy and the props that page files (pages/*.jsx) are allowed to
 * use. Implementation stacks (Astro, Next.js, plain SSG) map these 1:1.
 *
 * Layout system assumptions:
 * - max content width 1120px, centered, 24px gutters
 * - type scale: display / h1 / h2 / body / small
 * - one accent color used for CTAs and inline highlights only
 * - dark and light theme; code blocks always dark
 */

/* ---------------------------------------------------------- link contract -- */

/**
 * Placeholder API for links into the repository. Page specs MUST use this
 * instead of hand-written `…/` placeholders so implementers know exactly
 * what to resolve:
 *
 * - repoHref("docs/troubleshooting.md") → the canonical public URL for that
 *   repo path — today `https://github.com/sebastian-software/palamedes/blob/main/<path>`
 *   (or `/tree/main/<path>` for directories); later the docs-site route once
 *   docs are published on the site itself.
 * - Site-internal routes stay literal ("/proof", "/get-started").
 * - Fully external URLs stay literal ("https://...").
 *
 * The implementation is one function; swapping GitHub URLs for docs-site
 * routes later is a single-place change.
 */
export function repoHref(path) {}

/* ---------------------------------------------------------------- chrome -- */

/**
 * Sticky top navigation, identical on every page.
 * Left: wordmark. Center: primary routes. Right: GitHub link + primary CTA.
 * Collapses to a burger menu below 720px.
 */
export function SiteNav() {
  return (
    <nav>
      <Wordmark href="/" label="Palamedes" />
      <NavLinks>
        <a href="/frameworks">Frameworks</a>
        <a href="/proof">Proof</a>
        <a href="/compare">Compare</a>
        <a href="/blog">Blog</a>
        <a href="https://github.com/sebastian-software/palamedes/tree/main/docs">Docs</a>
      </NavLinks>
      <NavActions>
        <GitHubStarsButton repo="sebastian-software/palamedes" />
        <Button variant="primary" href="/get-started">
          Get started
        </Button>
      </NavActions>
    </nav>
  )
}

/**
 * Global footer, identical on every page.
 * Four link columns + legal strip with Sebastian Software attribution.
 */
export function SiteFooter() {
  return (
    <footer>
      <FooterColumn title="Product">
        <a href="/get-started">Get started</a>
        <a href="/frameworks">Framework matrix</a>
        <a href="/proof">Benchmarks & proof</a>
        <a href="/compare">Comparison</a>
      </FooterColumn>
      <FooterColumn title="Documentation">
        <a href={repoHref("docs/first-working-translation.md")}>5-minute quickstart</a>
        <a href={repoHref("docs/api/README.md")}>API reference</a>
        <a href={repoHref("docs/configuration.md")}>Configuration</a>
        <a href={repoHref("docs/cli.md")}>CLI</a>
        <a href={repoHref("docs/troubleshooting.md")}>Troubleshooting</a>
      </FooterColumn>
      <FooterColumn title="Project">
        <a href={repoHref("adr")}>Architecture decisions</a>
        <a href={repoHref("docs/stability.md")}>Stability & versioning</a>
        <a href={repoHref("CHANGELOG.md")}>Changelog</a>
        <a href={repoHref("SECURITY.md")}>Security</a>
        <a href={repoHref("LICENSE")}>MIT license</a>
      </FooterColumn>
      <FooterColumn title="Company">
        <a href="https://oss.sebastian-software.com/">Sebastian Software</a>
        <a href="https://sebastian-software.de/werner">Sebastian Werner</a>
        <a href="/blog">Blog</a>
      </FooterColumn>
      <LegalStrip>
        MIT © 2026 Sebastian Software GmbH — built in the open, verified in CI.
      </LegalStrip>
    </footer>
  )
}

/* --------------------------------------------------------------- content -- */

/**
 * Full-width hero. One headline, one subline, two CTAs, one proof visual.
 * Two-column ≥960px (copy left, visual right), stacked below.
 *
 * props:
 * - eyebrow:   small caps line above the headline (optional)
 * - headline:  the one-sentence promise
 * - subline:   2–3 sentences, concrete, no adjectives without evidence
 * - primary / secondary: CTA buttons { label, href }
 * - visual:    <Screenshot>, <LocaleMatrixAnimation>, or <CodeShowcase>
 */
export function Hero(props) {}

/**
 * Thin horizontal band of 3–5 hard facts directly under the hero.
 * Each stat: big number + one-line label + link to the evidence.
 * Never contains a number that has no checked-in source.
 *
 * props: stats: Array<{ value, label, href }>
 */
export function ProofStrip(props) {}

/**
 * Two-panel code presentation: source on the left (or top), rendered/derived
 * result on the right (or bottom). Tabs allow multiple variants.
 *
 * props:
 * - tabs: Array<{ label, code, language, caption }>
 * - result: optional rendered-output panel { title, content }
 */
export function CodeShowcase(props) {}

/**
 * Grid of feature cards. 3 columns ≥960px, 1 column mobile.
 * Card: icon, title (≤5 words), 2-sentence body, optional link.
 *
 * props: columns, cards: Array<{ icon, title, body, href? }>
 */
export function FeatureGrid(props) {}

/**
 * The 6×4 framework/strategy matrix as an interactive table.
 * Rows: framework families. Columns: locale strategies.
 *
 * Cells carry EXPLICIT links and a per-cell status — never a generated URL
 * pattern. The real URL shapes differ per strategy (cookie: one host; route:
 * locale path segment; subdomain: locale host label; tld: per-locale
 * `palamedes-i18n.{com,de,es,fr}` domains), and not every cell has public
 * hosting yet. Every cell shows its CI-verified badge; only cells with
 * status "live" render demo links. Source of truth for cell data:
 * examples/README.md + docs/demo-deployments.md (reconciliation tracked
 * in #306).
 *
 * props:
 * - frameworks: Array<{ name, slug }>
 * - strategies: Array<{ name, slug }>
 * - cells: Array<{
 *     framework, strategy,
 *     verified: true,                      // all 24 are CI verified
 *     status: "live" | "provisioning",     // public hosting state
 *     demoLinks?: Array<{ label, href }>,  // explicit, only when live
 *     sourceHref,                          // example source in the repo
 *   }>
 */
export function FrameworkMatrix(props) {}

/**
 * Shared cell data for <FrameworkMatrix>, used by HomePage and
 * FrameworksPage. Mirrors the per-strategy URL shapes documented in
 * examples/README.md ("Live Demos"). Per docs/demo-deployments.md the
 * subdomain and tld rows are not publicly reachable yet (DNS/domains
 * pending), so they carry status "provisioning" with no demo links until
 * #306 lands. Cookie demos have a single URL (locale via cookie); route
 * demos link per-locale paths.
 */
export const FRAMEWORK_MATRIX_CELLS = [
  "nextjs",
  "tanstack",
  "solidstart",
  "waku",
  "react-router",
].flatMap((framework) => [
  {
    framework,
    strategy: "cookie",
    verified: true,
    status: "live",
    demoLinks: [{ label: "open", href: `https://${framework}-cookie.examples.palamedes.dev` }],
    sourceHref: repoHref(`examples/${framework}-cookie`),
  },
  {
    framework,
    strategy: "route",
    verified: true,
    status: "live",
    demoLinks: ["en", "de", "es"].map((locale) => ({
      label: locale,
      href: `https://${framework}-route.examples.palamedes.dev/${locale}`,
    })),
    sourceHref: repoHref(`examples/${framework}-route`),
  },
  {
    framework,
    strategy: "subdomain",
    verified: true,
    status: "provisioning", // en.<framework>-subdomain.examples.palamedes.dev once DNS lands (#306)
    sourceHref: repoHref(`examples/${framework}-subdomain`),
  },
  {
    framework,
    strategy: "tld",
    verified: true,
    status: "provisioning", // <framework>.examples.palamedes-i18n.{com,de,es,fr} once domains land (#306)
    sourceHref: repoHref(`examples/${framework}-tld`),
  },
])

/**
 * Numbered step flow (horizontal up to 4 steps, vertical beyond and on
 * mobile), 3–6 steps max. Step: number, title, one-liner, optional small
 * code block, optional aside for caveats.
 *
 * props: steps: Array<{ title, body, code?, aside? }>
 */
export function StepFlow(props) {}

/**
 * Benchmark bar chart with mandatory methodology link.
 * Bars sorted fastest-first, values labeled in ms, log scale allowed
 * when ratios exceed 10×. Renders a caption with machine/date context.
 *
 * props: title, rows: Array<{ tool, median, samples }>, methodologyHref
 */
export function BenchmarkChart(props) {}

/**
 * Side-by-side comparison table. First column = criteria, one column per
 * tool. Cells are short phrases, never bare ✓/✗ without a footnote.
 *
 * props: criteria: string[], tools: Array<{ name, cells: string[] }>, footnotes
 */
export function CompareTable(props) {}

/**
 * Single large quote or statement band, used for the positioning line.
 * props: text, attribution?
 */
export function StatementBand(props) {}

/**
 * Screenshot with browser chrome frame and caption.
 * props: src, alt, caption, href?
 */
export function Screenshot(props) {}

/**
 * Animated (reduced-motion safe) visual cycling one UI card through
 * en → de → es, showing copy, plurals, currency, and dates changing
 * together. Falls back to the static localized-matrix image.
 * props: fallbackSrc
 */
export function LocaleMatrixAnimation(props) {}

/**
 * Full-width closing call-to-action band before the footer.
 * props: headline, primary: {label, href}, secondary?: {label, href}
 */
export function CtaBand(props) {}

/**
 * Blog post preview card: title, date, 2-line excerpt, read-time.
 * props: post: { title, date, excerpt, href, readMinutes }
 */
export function PostCard(props) {}
