import { FrameworkLandingPage } from "~/components/frameworks/FrameworkLandingPage"
import type { FrameworkLanding } from "~/data/framework-landing"
import { docsHref, NPM, repoHref } from "~/data/links"
import { frameworkMeta } from "~/lib/meta"

const page: FrameworkLanding = {
  name: "TanStack Start",
  path: "/frameworks/tanstack-start",
  eyebrow: "TanStack Start i18n · TypeScript",
  metaTitle: "TanStack Start i18n with TypeScript | Palamedes",
  metaDescription:
    "Add i18n to TanStack Start routes and server functions with TypeScript macros, PO catalogs, a Vite integration, and verified locale switching.",
  headline: "TanStack Start i18n for routes, server functions, and the client.",
  lede: "Palamedes connects TanStack Start's type-safe router and server functions to one source-string-first translation workflow. Locale routing stays in TanStack; macro transforms, catalogs, diagnostics, and runtime access stay coherent across the request.",
  primary: {
    label: "Open the TanStack Start demo",
    href: "https://tanstack-route.examples.palamedes.dev/en",
  },
  secondary: {
    label: "Browse the TypeScript source",
    href: repoHref("examples/tanstack-route", "tree"),
  },
  facts: [
    {
      label: "Integration",
      value: "@palamedes/vite-plugin",
      note: "Transforms macros before the React and Start pipeline.",
    },
    {
      label: "Verified against",
      value: "Start 1.168",
      note: "With TanStack Router 1.170 and Vite 8.",
    },
    {
      label: "Server model",
      value: "Server Functions",
      note: "Request data activates the matching server runtime.",
    },
    {
      label: "Locale models",
      value: "4 examples",
      note: "Cookie, route, subdomain, and top-level domain.",
    },
  ],
  problem: {
    title: "A typed locale route is useful only when the server function speaks the same locale.",
    lede: "TanStack Router can model localized URLs precisely. An i18n integration still has to carry that decision into SSR, server functions, browser hydration, and later client interactions without turning the router into a translation store.",
    points: [
      "Route params and locale redirects need to stay type-safe without coupling message catalogs to route generation.",
      "Each server function must activate the locale for its own request before a translated macro executes.",
      "The client runtime must follow navigation and switching while keeping the server-rendered language stable during hydration.",
    ],
  },
  approach: {
    title: "Let TanStack own navigation and Palamedes own translation semantics.",
    lede: "The integration composes at the Vite and request boundaries. It does not replace TanStack Router's route tree, rewrites, params, or metadata APIs.",
    points: [
      {
        title: "A normal Vite plugin",
        body: "The Palamedes plugin runs in the existing TanStack Start toolchain and compiles TypeScript macros plus imported PO catalogs.",
      },
      {
        title: "Explicit server activation",
        body: "A server function validates its locale input, activates a request-local i18n instance, and then uses the same t macro as application code.",
      },
      {
        title: "Router-native locale URLs",
        body: "Use required, optional, or rewritten locale params in TanStack Router. Palamedes follows the resolved locale instead of prescribing the URL.",
      },
    ],
  },
  code: {
    label: "vite.config.ts + server-functions.ts",
    caption: "The Vite adapter and server function meet at one runtime contract.",
    source: `// vite.config.ts
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import react from "@vitejs/plugin-react"
import { palamedes } from "@palamedes/vite-plugin"

export default {
  plugins: [
    tanstackStart(),
    palamedes({ runtimeModule: "@palamedes/react/runtime" }),
    react(),
  ],
}

// server-functions.ts
export const getStatus = createServerFn({ method: "GET" })
  .validator((data: { locale: Locale }) => data)
  .handler(async ({ data }) => {
    activateServerI18n(data.locale)
    return t\`Server function confirmed locale \${data.locale}.\`
  })`,
    note: "The checked route example derives the locale from a typed route param, passes it into server functions, and initializes the browser runtime for subsequent navigation.",
  },
  strategies: {
    matrixSlug: "tanstack",
    lede: "TanStack Router supports several localized URL patterns, including optional path params and rewrites. The Palamedes matrix keeps message handling identical while each example changes only the locale-resolution strategy.",
  },
  proof: {
    title: "Verified across the initial request and a later server-function call.",
    lede: "The browser flow checks more than rendered text. It proves that route resolution, client switching, and server work agree on one active locale.",
    facts: [
      {
        label: "Routing",
        value: "Redirect checked",
        note: "Accept-Language reaches the configured locale URL.",
      },
      {
        label: "Initial response",
        value: "SSR checked",
        note: "Localized content is present before client interaction.",
      },
      {
        label: "Server behavior",
        value: "Function checked",
        note: "A later server function returns translated output.",
      },
      {
        label: "Evidence",
        value: "4 app shapes",
        note: "Every locale strategy has source and CI coverage.",
      },
    ],
  },
  boundary: {
    title: "Palamedes translates content; TanStack Router still localizes URLs.",
    body: "Route rewrites, translated pathnames, alternate links, and metadata remain application or router concerns. Palamedes supplies locale helpers and translated messages without taking ownership of the route tree.",
    link: {
      label: "Read the locale strategy guide",
      href: docsHref("locale-strategies"),
    },
  },
  faq: [
    {
      q: "Does Palamedes replace TanStack Router's i18n routing patterns?",
      a: "No. Keep locale params, rewrites, redirects, and links in TanStack Router. Palamedes turns the locale resolved by those routes into the active catalog for server and client code.",
    },
    {
      q: "Can Palamedes translate TanStack Start server functions?",
      a: "Yes. Validate or normalize the locale at the server-function boundary, activate a request-local i18n instance, and use the same transformed macros as the rest of the application.",
    },
    {
      q: "Does it work with server-side rendering?",
      a: "Yes. The example matrix verifies localized SSR output and then checks client switching plus a localized server-function response.",
    },
    {
      q: "How does this compare with Paraglide in the TanStack guide?",
      a: "Paraglide offers a generated, typesafe message API and dedicated URL-localization helpers. Palamedes uses source-string-first PO or FCL catalogs, macro-style authoring, a native catalog toolchain, and one runtime model shared with its other supported hosts.",
    },
  ],
  related: [
    { label: "React Router i18n in Framework Mode", href: "/frameworks/react-router" },
    { label: "Vite i18n for React and Solid", href: "/frameworks/vite" },
    { label: "Next.js App Router i18n", href: "/frameworks/nextjs" },
  ],
  finalCta: {
    headline: "Keep TanStack's route types and add a coherent translation toolchain.",
    primary: {
      label: "Open the live route demo",
      href: "https://tanstack-route.examples.palamedes.dev/en",
    },
    secondary: {
      label: "View @palamedes/vite-plugin",
      href: NPM("@palamedes/vite-plugin"),
    },
  },
}

export const handle = { layout: "bare" }

export function meta() {
  return frameworkMeta({
    title: page.metaTitle,
    description: page.metaDescription,
    path: page.path,
    framework: page.name,
    faq: page.faq,
  })
}

export default function TanstackStartI18n() {
  return <FrameworkLandingPage page={page} />
}
