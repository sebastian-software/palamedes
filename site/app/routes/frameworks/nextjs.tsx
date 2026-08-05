import { FrameworkLandingPage } from "~/components/frameworks/FrameworkLandingPage"
import type { FrameworkLanding } from "~/data/framework-landing"
import { docsHref, NPM, repoHref } from "~/data/links"
import { frameworkMeta } from "~/lib/meta"

const page: FrameworkLanding = {
  name: "Next.js",
  path: "/frameworks/nextjs",
  eyebrow: "Next.js i18n · TypeScript",
  metaTitle: "Next.js i18n with TypeScript | Palamedes",
  metaDescription:
    "Internationalize the Next.js App Router with TypeScript macros, request-scoped Server Component rendering, PO catalogs, and verified locale strategies.",
  headline: "Next.js i18n for the App Router, from server to client.",
  lede: "Palamedes gives Next.js 16 one translation model across Server Components, Client Components, and server actions. The Next plugin handles macro transforms and catalog loading; your application keeps control of routing and locale policy.",
  primary: {
    label: "Open the Next.js demo",
    href: "https://nextjs-route.examples.palamedes.dev/en",
  },
  secondary: {
    label: "Browse the TypeScript source",
    href: repoHref("examples/nextjs-route", "tree"),
  },
  facts: [
    {
      label: "Integration",
      value: "@palamedes/next-plugin",
      note: "One host adapter for macro transforms and PO imports.",
    },
    {
      label: "Verified against",
      value: "Next.js 16.2",
      note: "App Router with the current Turbopack path.",
    },
    {
      label: "Rendering",
      value: "RSC + client",
      note: "Server Components, Client Components, and server actions.",
    },
    {
      label: "Locale models",
      value: "4 examples",
      note: "Cookie, route, subdomain, and top-level domain.",
    },
  ],
  problem: {
    title: "Next.js makes locale routing visible. The harder boundary is request-local rendering.",
    lede: "A locale segment or cookie is only the first decision. Translations must resolve to the same locale while React crosses server and client boundaries, streams HTML, hydrates the browser, and runs a server action later.",
    points: [
      "Server Components need a request-scoped i18n instance without leaking locale state between requests.",
      "Client hydration must start with the same catalog and locale that produced the server HTML.",
      "Message macros and PO imports must work through the Next.js 16 build pipeline before either side executes them.",
    ],
  },
  approach: {
    title: "Keep the framework-specific wiring at the edge of one i18n model.",
    lede: "Palamedes treats Next.js as a host, not as a separate translation architecture. The adapter owns the build integration while the core keeps message identity, catalogs, diagnostics, and runtime access consistent.",
    points: [
      {
        title: "A native Next.js build path",
        body: "withPalamedes() transforms TypeScript macros and compiles imported PO catalogs for Turbopack, with webpack available as a fallback.",
      },
      {
        title: "Request-scoped server i18n",
        body: "A server-only scope binds getI18n() to the active request so downstream Server Components and actions use the right locale.",
      },
      {
        title: "The same authoring model",
        body: "Write t and Trans next to the component. Server and client code share source-string-first catalogs instead of maintaining parallel APIs.",
      },
    ],
  },
  code: {
    label: "next.config.ts + app/page.tsx",
    caption: "The adapter is visible in config. The translation stays beside the UI.",
    source: `// next.config.ts
import { withPalamedes } from "@palamedes/next-plugin"

export default withPalamedes({})

// app/page.tsx — a Server Component
import { t } from "@palamedes/core/macro"
import { createActiveServerI18n } from "@/lib/i18n.server"

export default async function Page() {
  await createActiveServerI18n()
  return <h1>{t\`Welcome to Palamedes\`}</h1>
}`,
    note: "The server helper resolves the locale, loads its catalog, and activates a request-local scope once. The checked example also initializes the client boundary and verifies a localized server action.",
  },
  strategies: {
    matrixSlug: "nextjs",
    lede: "Next.js owns URL structure and request handling. Palamedes supplies typed locale controls and the same catalog runtime for all four patterns, so choosing an SEO-friendly route segment does not require choosing a different translation library.",
  },
  proof: {
    title: "A real App Router application, exercised like a user would use it.",
    lede: "The Next.js family is part of the repository's browser-verification matrix. The checks start the application, inspect server-rendered output, switch locale, and invoke translated server behavior.",
    facts: [
      {
        label: "Initial response",
        value: "SSR checked",
        note: "The expected locale is present before hydration.",
      },
      {
        label: "Interaction",
        value: "Switch checked",
        note: "Copy, plurals, dates, and currency move together.",
      },
      {
        label: "Server behavior",
        value: "Action checked",
        note: "A server action returns localized output after interaction.",
      },
      {
        label: "Evidence",
        value: "Source + CI",
        note: "Examples, verifier, and screenshots are checked in.",
      },
    ],
  },
  boundary: {
    title: "Current boundary: the request scope targets the Node runtime.",
    body: "The @palamedes/next-plugin/server entry binds i18n to the complete Node render lifetime and must stay out of Edge and Client Components. Direct catalog imports currently use PO files even when FCL is configured for other catalog workflows.",
    link: {
      label: "Read the Next.js integration notes",
      href: docsHref("api/next-plugin"),
    },
  },
  faq: [
    {
      q: "Does Palamedes replace Next.js internationalized routing?",
      a: "No. Next.js still owns routes, redirects, middleware, and URL design. Palamedes handles translated messages, catalogs, diagnostics, and the runtime that follows the locale your application resolved.",
    },
    {
      q: "Does Next.js i18n work in Server Components?",
      a: "Yes on the verified Node runtime path. Initialize one request-local server scope before downstream Server Components call Palamedes macros; keep that server-only module outside Edge and client bundles.",
    },
    {
      q: "Can the same messages run in Client Components and server actions?",
      a: "Yes. The React runtime initializes the browser-side instance while the server scope serves Server Components and actions. Both consume the same source-string-first catalogs.",
    },
    {
      q: "How is this different from next-intl?",
      a: "next-intl is deeply centered on Next.js. Palamedes provides a broader source-to-runtime toolchain with a native core, repository-owned PO or FCL catalogs, semantic merging, audits, and first-party adapters across several hosts. The right choice depends on whether that shared workflow matters to your team.",
    },
  ],
  related: [
    { label: "Waku i18n for React Server Components", href: "/frameworks/waku" },
    { label: "TanStack Start i18n", href: "/frameworks/tanstack-start" },
    { label: "Vite i18n for React and Solid", href: "/frameworks/vite" },
  ],
  finalCta: {
    headline: "See Next.js switch locale without switching i18n models.",
    primary: {
      label: "Open the live route demo",
      href: "https://nextjs-route.examples.palamedes.dev/en",
    },
    secondary: {
      label: "View @palamedes/next-plugin",
      href: NPM("@palamedes/next-plugin"),
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

export default function NextjsI18n() {
  return <FrameworkLandingPage page={page} />
}
