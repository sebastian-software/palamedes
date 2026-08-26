import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(import.meta.dirname, "..")

// These public identities are deliberately independent of EXAMPLE_MATRIX.
// The guard compares matrix-derived values to them so a whole-family or
// whole-strategy rename cannot preserve cardinality while breaking selectors.
export const SERVER_FRAMEWORKS = ["nextjs", "tanstack", "waku", "react-router", "solid", "remix"]
export const LOCALE_STRATEGIES = ["cookie", "route", "subdomain", "tld"]
export const VITE_EXAMPLE = { framework: "vite", strategy: "client", id: "vite-mdx" }

// Focused production fixtures are intentionally outside the cross-framework
// locale-strategy matrix. They have dedicated verifiers and must remain
// discoverable by tooling that inventories the examples directory.
export const FOCUSED_EXAMPLES = ["react-router-rsc-cookie"]

export const EXAMPLE_MATRIX = [
  {
    id: "nextjs-cookie",
    framework: "nextjs",
    strategy: "cookie",
    port: 4010,
    cwd: path.join(ROOT, "examples/nextjs-cookie"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { "accept-language": "en" },
        path: "/",
        htmlLang: "en",
        substrings: ["English", "seats left"],
      },
    ],
  },
  {
    id: "nextjs-route",
    framework: "nextjs",
    strategy: "route",
    port: 4011,
    cwd: path.join(ROOT, "examples/nextjs-route"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
      {
        path: "/de",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "de.lvh.me:4011" },
        path: "/en",
        htmlLang: "en",
        substrings: ["This host is mapped to Deutsch"],
      },
    ],
  },
  {
    id: "tanstack-cookie",
    framework: "tanstack",
    strategy: "cookie",
    port: 4020,
    cwd: path.join(ROOT, "examples/tanstack-cookie"),
    build: ["build"],
    start: ["preview"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { "accept-language": "en" },
        path: "/",
        htmlLang: "en",
        substrings: ["English", "seats left"],
      },
    ],
  },
  {
    id: "tanstack-route",
    framework: "tanstack",
    strategy: "route",
    port: 4021,
    cwd: path.join(ROOT, "examples/tanstack-route"),
    build: ["build"],
    start: ["preview"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
      {
        path: "/de",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "de.lvh.me:4021" },
        path: "/en",
        htmlLang: "en",
        substrings: ["This host is mapped to Deutsch"],
      },
    ],
  },
  {
    id: "waku-cookie",
    framework: "waku",
    strategy: "cookie",
    port: 4030,
    cwd: path.join(ROOT, "examples/waku-cookie"),
    build: ["build"],
    start: ["start"],
    // Waku pre-renders `src/pages/_root.tsx` once, so the served document always
    // carries `lang="en"` and the client bootstrap applies the active locale (see
    // the waku section of `docs/framework-example-notes.md`). Asserting that
    // literal `en` keeps the constraint visible: it turns red once Waku can emit
    // a per-request shell. The verifier's deterministic i18n-concurrency pass
    // below additionally overlaps two request scopes.
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { "accept-language": "en" },
        path: "/",
        htmlLang: "en",
        substrings: ["English", "seats left"],
      },
    ],
  },
  {
    id: "waku-route",
    framework: "waku",
    strategy: "route",
    port: 4031,
    cwd: path.join(ROOT, "examples/waku-route"),
    build: ["build"],
    start: ["start"],
    // See waku-cookie for why the document lang stays `en` on every locale.
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
      {
        path: "/de",
        htmlLang: "en",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "de.lvh.me:4031" },
        path: "/en",
        htmlLang: "en",
        substrings: ["This host is mapped to Deutsch"],
      },
    ],
  },
  {
    id: "react-router-cookie",
    framework: "react-router",
    strategy: "cookie",
    port: 4040,
    cwd: path.join(ROOT, "examples/react-router-cookie"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { "accept-language": "en" },
        path: "/",
        htmlLang: "en",
        substrings: ["English", "seats left"],
      },
    ],
  },
  {
    id: "react-router-route",
    framework: "react-router",
    strategy: "route",
    port: 4041,
    cwd: path.join(ROOT, "examples/react-router-route"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
      {
        path: "/de",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "de.lvh.me:4041" },
        path: "/en",
        htmlLang: "en",
        substrings: ["This host is mapped to Deutsch"],
      },
    ],
  },
  {
    id: "vite-mdx",
    framework: "vite",
    strategy: "client",
    port: 4070,
    cwd: path.join(ROOT, "examples/vite-mdx"),
    build: ["build"],
    start: ["preview"],
    // This is a client-only Vite application. The browser contract below
    // verifies all three MDX pages and the document-level locale switch.
    smokeChecks: [],
    smokeDocumentOptOut:
      "the served document is the static index.html shell; every locale decision happens after the bundle boots, so there is no server-rendered locale to fetch",
  },
  {
    id: "solid-cookie",
    framework: "solid",
    strategy: "cookie",
    port: 4050,
    cwd: path.join(ROOT, "examples/solid-cookie"),
    build: ["build"],
    start: ["start"],
    startEnv: {
      HOST: "127.0.0.1",
      PORT: "4050",
    },
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { "accept-language": "en" },
        path: "/",
        htmlLang: "en",
        substrings: ["English", "seats left"],
      },
    ],
  },
  {
    id: "remix-cookie",
    framework: "remix",
    strategy: "cookie",
    port: 4060,
    cwd: path.join(ROOT, "examples/remix-cookie"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { "accept-language": "de" },
        htmlLang: "de",
        path: "/frames",
        substrings: ["Diese Antwort", "Active frame locale", "Deutsch"],
      },
      {
        // The frame endpoint streams the partial on its own, so this response
        // has no document element to carry a lang attribute.
        headers: { "accept-language": "de" },
        htmlLang: null,
        path: "/frames/locale-summary",
        substrings: ["Diese Antwort", "Active frame locale", "Deutsch"],
      },
    ],
  },
  {
    id: "remix-route",
    framework: "remix",
    strategy: "route",
    port: 4061,
    cwd: path.join(ROOT, "examples/remix-route"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
      {
        path: "/de",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "de.lvh.me:4061" },
        path: "/en",
        htmlLang: "en",
        substrings: ["This host is mapped to Deutsch"],
      },
    ],
  },
  {
    id: "remix-subdomain",
    framework: "remix",
    strategy: "subdomain",
    port: 4062,
    cwd: path.join(ROOT, "examples/remix-subdomain"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { host: "de.lvh.me:4062" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "en.lvh.me:4062", "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
    ],
  },
  {
    id: "remix-tld",
    framework: "remix",
    strategy: "tld",
    port: 4063,
    cwd: path.join(ROOT, "examples/remix-tld"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { host: "remix.example.de:4063" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "remix.example.fr:4063" },
        path: "/",
        htmlLang: "fr",
        substrings: ["Remix v3 affiche", "places restantes"],
      },
      {
        headers: { host: "remix.example.com:4063", "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
    ],
  },
  {
    id: "solid-route",
    framework: "solid",
    strategy: "route",
    port: 4051,
    cwd: path.join(ROOT, "examples/solid-route"),
    build: ["build"],
    start: ["start"],
    startEnv: {
      HOST: "127.0.0.1",
      PORT: "4051",
    },
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
      {
        path: "/de",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "de.lvh.me:4051" },
        path: "/en",
        htmlLang: "en",
        substrings: ["This host is mapped to Deutsch"],
      },
    ],
  },
  {
    id: "nextjs-subdomain",
    framework: "nextjs",
    strategy: "subdomain",
    port: 4012,
    cwd: path.join(ROOT, "examples/nextjs-subdomain"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { host: "de.lvh.me:4012" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "en.lvh.me:4012", "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
    ],
  },
  {
    id: "tanstack-subdomain",
    framework: "tanstack",
    strategy: "subdomain",
    port: 4022,
    cwd: path.join(ROOT, "examples/tanstack-subdomain"),
    build: ["build"],
    start: ["preview"],
    smokeChecks: [
      {
        headers: { host: "de.lvh.me:4022" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "en.lvh.me:4022", "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
    ],
  },
  {
    id: "waku-subdomain",
    framework: "waku",
    strategy: "subdomain",
    port: 4032,
    cwd: path.join(ROOT, "examples/waku-subdomain"),
    build: ["build"],
    start: ["start"],
    // See waku-cookie for why the document lang stays `en` on every locale.
    smokeChecks: [
      {
        headers: { host: "de.lvh.me:4032" },
        path: "/",
        htmlLang: "en",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "en.lvh.me:4032", "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
    ],
  },
  {
    id: "react-router-subdomain",
    framework: "react-router",
    strategy: "subdomain",
    port: 4042,
    cwd: path.join(ROOT, "examples/react-router-subdomain"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { host: "de.lvh.me:4042" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "en.lvh.me:4042", "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
    ],
  },
  {
    id: "solid-subdomain",
    framework: "solid",
    strategy: "subdomain",
    port: 4052,
    cwd: path.join(ROOT, "examples/solid-subdomain"),
    build: ["build"],
    start: ["start"],
    startEnv: {
      HOST: "127.0.0.1",
      PORT: "4052",
    },
    smokeChecks: [
      {
        headers: { host: "de.lvh.me:4052" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "en.lvh.me:4052", "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
    ],
  },
  {
    id: "nextjs-tld",
    framework: "nextjs",
    strategy: "tld",
    port: 4013,
    cwd: path.join(ROOT, "examples/nextjs-tld"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { host: "palamedes-i18n.de:4013" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "palamedes-i18n.fr:4013" },
        path: "/",
        htmlLang: "fr",
        substrings: ["français", "places restantes"],
      },
      {
        // `.com` maps to `en` (explicit tld override), so it is authoritative and
        // wins over the browser preference (Accept-Language `de`).
        headers: { host: "palamedes-i18n.com:4013", "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["English", "seats left"],
      },
    ],
  },
  {
    id: "tanstack-tld",
    framework: "tanstack",
    strategy: "tld",
    port: 4023,
    cwd: path.join(ROOT, "examples/tanstack-tld"),
    build: ["build"],
    start: ["preview"],
    smokeChecks: [
      {
        headers: { host: "palamedes-i18n.de:4023" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "palamedes-i18n.fr:4023" },
        path: "/",
        htmlLang: "fr",
        substrings: ["français", "places restantes"],
      },
      {
        // `.com` maps to `en` (explicit tld override), so it is authoritative and
        // wins over the browser preference (Accept-Language `de`).
        headers: { host: "palamedes-i18n.com:4023", "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["English", "seats left"],
      },
    ],
  },
  {
    id: "waku-tld",
    framework: "waku",
    strategy: "tld",
    port: 4033,
    cwd: path.join(ROOT, "examples/waku-tld"),
    build: ["build"],
    start: ["start"],
    // See waku-cookie for why the document lang stays `en` on every locale.
    smokeChecks: [
      {
        headers: { host: "palamedes-i18n.de:4033" },
        path: "/",
        htmlLang: "en",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "palamedes-i18n.fr:4033" },
        path: "/",
        htmlLang: "en",
        substrings: ["français", "places restantes"],
      },
      {
        headers: { host: "palamedes-i18n.com:4033", "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["English", "seats left"],
      },
    ],
  },
  {
    id: "react-router-tld",
    framework: "react-router",
    strategy: "tld",
    port: 4043,
    cwd: path.join(ROOT, "examples/react-router-tld"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { host: "palamedes-i18n.de:4043" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "palamedes-i18n.fr:4043" },
        path: "/",
        htmlLang: "fr",
        substrings: ["français", "places restantes"],
      },
      {
        // `.com` maps to `en` (explicit tld override), so it is authoritative and
        // wins over the browser preference (Accept-Language `de`).
        headers: { host: "palamedes-i18n.com:4043", "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["English", "seats left"],
      },
    ],
  },
  {
    id: "solid-tld",
    framework: "solid",
    strategy: "tld",
    port: 4053,
    cwd: path.join(ROOT, "examples/solid-tld"),
    build: ["build"],
    start: ["start"],
    startEnv: {
      HOST: "127.0.0.1",
      PORT: "4053",
    },
    smokeChecks: [
      {
        headers: { host: "palamedes-i18n.de:4053" },
        path: "/",
        htmlLang: "de",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "palamedes-i18n.fr:4053" },
        path: "/",
        htmlLang: "fr",
        substrings: ["français", "places restantes"],
      },
      {
        // `.com` maps to `en` (explicit tld override), so it is authoritative and
        // wins over the browser preference (Accept-Language `de`).
        headers: { host: "palamedes-i18n.com:4053", "accept-language": "de" },
        path: "/",
        htmlLang: "en",
        substrings: ["English", "seats left"],
      },
    ],
  },
]

export function parseExampleArgs(argv) {
  const filters = {}
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--id") {
      filters.id = argv[index + 1]
      index += 1
      continue
    }
    if (value === "--framework") {
      filters.framework = argv[index + 1]
      index += 1
      continue
    }
    if (value === "--strategy") {
      filters.strategy = argv[index + 1]
      index += 1
    }
  }
  return filters
}

export function selectExamples(filters) {
  return EXAMPLE_MATRIX.filter((example) => {
    if (filters.id && example.id !== filters.id) {
      return false
    }
    if (filters.framework && example.framework !== filters.framework) {
      return false
    }
    if (filters.strategy && example.strategy !== filters.strategy) {
      return false
    }
    return true
  })
}

// The server matrix is six framework families by four locale strategies. Vite
// is an additional client-only MDX proof, rather than a seventh server family
// or a fifth locale strategy.
export const SERVER_EXAMPLES = EXAMPLE_MATRIX.filter((example) =>
  SERVER_FRAMEWORKS.includes(example.framework)
)

// Remix v3 is deliberately server-first while its component/UI adapter settles.
// Its four entries have smoke contracts, but not the shared browser-interaction
// contract that the other framework families and Vite exercise.
export function selectBrowserExamples(filters) {
  return selectExamples(filters).filter((example) => example.framework !== "remix")
}

// The checked-in screenshot set records the established UI-adapter matrix.
// Vite has the browser contract but no capture artifact, and Remix is smoke-only.
export function selectScreenshotExamples(filters) {
  return selectExamples(filters).filter(
    (example) => example.framework !== "remix" && example.framework !== "vite"
  )
}

// The browser lane verifies every browser-capable example and gates capture per
// example, so narrowing the screenshot set can never narrow what runs. Pairing
// the two selections here keeps that rule testable instead of leaving it inside
// the runner script.
export function planBrowserRun(filters, browserOptions) {
  const screenshotIds = new Set(selectScreenshotExamples(filters).map((example) => example.id))

  return selectBrowserExamples(filters).map((example) => ({
    example,
    options: {
      ...browserOptions,
      captureScreenshots:
        Boolean(browserOptions.captureScreenshots) && screenshotIds.has(example.id),
    },
  }))
}
