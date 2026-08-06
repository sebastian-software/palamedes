import { FrameworkLandingPage } from "~/components/frameworks/FrameworkLandingPage"
import type { FrameworkLanding } from "~/data/framework-landing"
import { docsHref, NPM, repoHref } from "~/data/links"
import { frameworkMeta } from "~/lib/meta"

const page: FrameworkLanding = {
  name: "SolidStart",
  path: "/frameworks/solidstart",
  eyebrow: "SolidStart i18n · TypeScript",
  metaTitle: "SolidStart i18n with TypeScript | Palamedes",
  metaDescription:
    "Add i18n to SolidStart with TypeScript macros, hook-free client lookup, server-side translation, PO catalogs, and verified locale strategies.",
  headline: "SolidStart i18n that stays native to Solid.",
  lede: "Palamedes pairs a Vite build integration with dedicated Solid authoring and runtime packages. Solid-native components and hook-free lookups share one catalog model across request-local SSR and hydration.",
  primary: {
    label: "Open the SolidStart demo",
    href: "https://solidstart-route.examples.palamedes.dev/en",
  },
  secondary: {
    label: "Browse the TypeScript source",
    href: repoHref("examples/solidstart-route", "tree"),
  },
  facts: [
    {
      label: "UI integration",
      value: "@palamedes/solid",
      note: "Solid macros, formatters, and locale primitives.",
    },
    {
      label: "Verified against",
      value: "SolidStart 2.0",
      note: "Vite Environment API, Nitro v3, and Vite 8.",
    },
    {
      label: "Rendering",
      value: "SSR + client",
      note: "Isomorphic routes with one locale per document.",
    },
    {
      label: "Locale models",
      value: "4 examples",
      note: "Cookie, route, subdomain, and top-level domain.",
    },
  ],
  problem: {
    title:
      "SolidStart i18n has to cross the server boundary without importing a React mental model.",
    lede: "A Solid application should not need provider patterns designed for another renderer. Locale state must still agree across the server response, hydration, and a later document navigation.",
    points: [
      "Server-side macros need the request's active catalog before an isomorphic route renders.",
      "The client locale must be initialized before hydration without turning ordinary translation getters into Solid dependencies.",
      "Rich messages and locale controls need Solid-specific primitives rather than a thin React compatibility layer.",
    ],
  },
  approach: {
    title: "Share catalog semantics, not renderer internals.",
    lede: "The native core and Vite adapter stay common across hosts. @palamedes/solid owns rich-message rendering while the active locale remains framework-neutral document bootstrap state.",
    points: [
      {
        title: "Solid-native authoring",
        body: "Use t, plural, and the Solid Trans macro beside JSX. Rich messages compile for Solid instead of passing through a React adapter.",
      },
      {
        title: "Hook-free document locale",
        body: "Translations read one active instance through a plain getter. Locale controls navigate the document so Solid state and external caches restart together.",
      },
      {
        title: "One catalog pipeline",
        body: "The same extraction, ICU diagnostics, PO or FCL storage, audits, and semantic merging apply before the renderer sees a message.",
      },
    ],
  },
  code: {
    label: "vite.config.ts + routes/[locale].tsx",
    caption: "Configure the transform once, then author messages as Solid code.",
    source: `// vite.config.ts
import { nitro } from "nitro/vite"
import { defineConfig } from "vite"
import { solidStart } from "@solidjs/start/config"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [
    palamedes({ framework: "solid" }),
    solidStart(),
    nitro(),
  ],
})

// routes/[locale].tsx
import { Trans } from "@palamedes/solid/macro"

export default function LocalePage() {
  return <h1><Trans>Welcome to Palamedes</Trans></h1>
}`,
    note: "The route example activates a request-local server instance for SSR, initializes the browser locale once, and uses normal links for locale navigation.",
  },
  strategies: {
    matrixSlug: "solidstart",
    lede: "SolidStart's file routes and request APIs decide where the locale lives. Each checked Palamedes example keeps the Solid authoring and runtime surface unchanged while swapping the detection and switching policy.",
  },
  proof: {
    title: "Solid behavior is verified, not inferred from the React adapter.",
    lede: "The SolidStart matrix uses @palamedes/solid directly. Browser checks exercise the rendered page, the locale switch, and localized server work for every URL strategy.",
    facts: [
      {
        label: "Renderer",
        value: "Solid-native",
        note: "No React provider or React translation component.",
      },
      {
        label: "Initial response",
        value: "SSR checked",
        note: "The selected catalog renders before hydration.",
      },
      {
        label: "Interaction",
        value: "Navigation checked",
        note: "A new document renders consistently in the selected locale.",
      },
      {
        label: "Server behavior",
        value: "Handler checked",
        note: "Translated server output is exercised in CI.",
      },
    ],
  },
  boundary: {
    title: "Current proof targets stable SolidStart 2.",
    body: "All four checked examples use SolidStart 2's direct Vite Environment API path with Nitro v3 output. The matrix verifies the same Palamedes plugin across cookie, route, subdomain, and top-level-domain locale strategies.",
    link: {
      label: "Read the Solid API guide",
      href: docsHref("api/solid"),
    },
  },
  faq: [
    {
      q: "Is Palamedes for SolidStart a React wrapper?",
      a: "No. @palamedes/solid provides Solid-specific macros, components, formatters, runtime wiring, and client locale helpers. Only the lower catalog and transformation model is shared.",
    },
    {
      q: "Does SolidStart i18n work during server-side rendering?",
      a: "Yes on the verified SolidStart 2 path. The example activates a server i18n instance before route rendering and initializes the matching client locale for hydration.",
    },
    {
      q: "Can I use route-based locales such as /de/products?",
      a: "Yes. The route example derives the locale from a dynamic SolidStart segment. Cookie, subdomain, and top-level-domain examples use the same messages and Solid runtime with different resolution policies.",
    },
    {
      q: "Is SolidStart 2 verified?",
      a: "Yes. The browser matrix pins SolidStart 2.0 and exercises the direct Vite plus Nitro v3 path across all four locale strategies.",
    },
  ],
  related: [
    { label: "Vite i18n for React and Solid", href: "/frameworks/vite" },
    { label: "TanStack Start i18n", href: "/frameworks/tanstack-start" },
    { label: "React Router i18n in Framework Mode", href: "/frameworks/react-router" },
  ],
  finalCta: {
    headline: "Use Solid for the renderer and one coherent model for the translations.",
    primary: {
      label: "Open the live route demo",
      href: "https://solidstart-route.examples.palamedes.dev/en",
    },
    secondary: {
      label: "View @palamedes/solid",
      href: NPM("@palamedes/solid"),
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

export default function SolidStartI18n() {
  return <FrameworkLandingPage page={page} />
}
