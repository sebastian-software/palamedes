import { FrameworkLandingPage } from "~/components/frameworks/FrameworkLandingPage"
import type { FrameworkLanding } from "~/data/framework-landing"
import { docsHref, NPM, repoHref } from "~/data/links"
import { frameworkMeta } from "~/lib/meta"

const page: FrameworkLanding = {
  name: "Waku",
  path: "/frameworks/waku",
  eyebrow: "Waku i18n · React Server Components",
  metaTitle: "Waku i18n for React Server Components | Palamedes",
  metaDescription:
    "Internationalize Waku Server and Client Components with TypeScript macros, request-local catalogs, Vite transforms, and verified locale strategies.",
  headline: "Waku i18n across React Server and Client Components.",
  lede: "Palamedes keeps translation state aligned across Waku's React Server Component tree and its hydrated client islands. A Vite adapter transforms messages; the shared runtime resolves the active catalog on the correct side of the boundary.",
  primary: {
    label: "Open the Waku demo",
    href: "https://waku-route.examples.palamedes.dev/en",
  },
  secondary: {
    label: "Browse the TypeScript source",
    href: repoHref("examples/waku-route", "tree"),
  },
  facts: [
    {
      label: "Build integration",
      value: "@palamedes/vite-plugin",
      note: "Configured inside Waku's Vite plugin surface.",
    },
    {
      label: "Verified against",
      value: "Waku 1 RC",
      note: "React 19 Server Components on 1.0.0-rc.0.",
    },
    {
      label: "Rendering",
      value: "RSC + islands",
      note: "Server-first pages with hydrated client boundaries.",
    },
    {
      label: "Locale models",
      value: "4 examples",
      note: "Cookie, route, subdomain, and top-level domain.",
    },
  ],
  problem: {
    title: "RSC moves the translation boundary before the traditional client application starts.",
    lede: "Waku begins with a Server Component tree, then introduces client boundaries only where interactivity is needed. Locale state must be available in both environments without shipping server machinery to the browser or rendering two languages during hydration.",
    points: [
      "Server Components need an active request-local catalog before translated JSX and macro calls execute.",
      "Client Components need a browser runtime that starts with the server-selected locale and updates independently afterward.",
      "The build pipeline must transform messages for both Waku environments without changing the component architecture.",
    ],
  },
  approach: {
    title: "Treat the server and client as two hosts of one compiled message model.",
    lede: "Palamedes keeps the environment-specific activation explicit while sharing authoring, catalogs, ICU semantics, and diagnostics across the RSC boundary.",
    points: [
      {
        title: "Waku-native Vite composition",
        body: "Add the Palamedes transform through Waku's vite.plugins configuration beside the React plugin already used by the application.",
      },
      {
        title: "Server-first activation",
        body: "Resolve the request locale and activate a fresh i18n instance before the Server Component page calls t or Trans.",
      },
      {
        title: "Small client boundaries",
        body: "Only interactive islands load the React client helpers. Server-rendered translated content does not require turning the whole page into a Client Component.",
      },
    ],
  },
  code: {
    label: "waku.config.ts + pages/[locale].tsx",
    caption: "Palamedes joins Waku's Vite pipeline without changing the RSC page model.",
    source: `// waku.config.ts
import react from "@vitejs/plugin-react"
import { defineConfig } from "waku/config"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  vite: {
    plugins: [
      palamedes(),
      react(),
    ],
  },
})

// pages/[locale].tsx — a Server Component
import { t } from "@palamedes/core/macro"

export default async function LocalePage() {
  return <h1>{t\`Welcome to Palamedes\`}</h1>
}`,
    note: "The checked example resolves and activates the request locale before rendering this page, then initializes only the interactive client components with the same catalog.",
  },
  strategies: {
    matrixSlug: "waku",
    lede: "Waku decides how pages map to URLs and requests. Palamedes keeps the RSC and client translation model fixed while the matrix changes where the locale is detected and how a switch is represented.",
  },
  proof: {
    title: "The matrix exercises both halves of the React Server Component architecture.",
    lede: "Waku has its own browser-verified example family. It is not counted as proof merely because the Next.js adapter also supports Server Components.",
    facts: [
      {
        label: "Server tree",
        value: "RSC checked",
        note: "Translated output is rendered in the server-first page.",
      },
      {
        label: "Client boundary",
        value: "Island checked",
        note: "Interactive translated components hydrate and switch.",
      },
      {
        label: "Locale behavior",
        value: "4 strategies",
        note: "Host and path decisions are verified separately.",
      },
      {
        label: "Evidence",
        value: "Live + source",
        note: "Three hosted strategies plus the checked TLD source.",
      },
    ],
  },
  boundary: {
    title: "Current proof follows Waku's RC API.",
    body: "The matrix pins Waku 1.0.0-rc.0, and the integration is intentionally thin and Vite-based. Re-verify version-specific behavior when adopting the stable release; claims on this page follow the checked example.",
    link: {
      label: "Read the RSC i18n guide",
      href: "/react-server-components-i18n",
    },
  },
  faq: [
    {
      q: "Can Palamedes translate Waku Server Components?",
      a: "Yes. Activate the request's i18n instance before the Server Component tree executes translated macros. The checked Waku examples render localized server output for all four locale strategies.",
    },
    {
      q: "Do translated Waku pages become Client Components?",
      a: "No. Server Components can render translated messages on the server. Only interactive islands that react to a client-side locale change need the React client runtime.",
    },
    {
      q: "How does the locale cross the RSC boundary?",
      a: "The server resolves and activates its request-local catalog. The client boundary is initialized with the same locale and messages before interactive translated components run.",
    },
    {
      q: "Is Waku support production-stable?",
      a: "Palamedes browser-verifies its Waku integration, but the framework version in the matrix is still a Waku 1 release candidate. Evaluate that upstream maturity separately from the translation integration.",
    },
  ],
  related: [
    { label: "Next.js App Router i18n", href: "/frameworks/nextjs" },
    { label: "Vite i18n for React and Solid", href: "/frameworks/vite" },
    { label: "React Router i18n in Framework Mode", href: "/frameworks/react-router" },
  ],
  finalCta: {
    headline: "Keep Waku server-first and make every boundary speak the same locale.",
    primary: {
      label: "Open the live route demo",
      href: "https://waku-route.examples.palamedes.dev/en",
    },
    secondary: {
      label: "View @palamedes/react",
      href: NPM("@palamedes/react"),
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

export default function WakuI18n() {
  return <FrameworkLandingPage page={page} />
}
