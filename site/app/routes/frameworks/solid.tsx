import { FrameworkLandingPage } from "~/components/frameworks/FrameworkLandingPage"
import type { FrameworkLanding } from "~/data/framework-landing"
import { docsHref, NPM, repoHref } from "~/data/links"
import { frameworkMeta } from "~/lib/meta"

const page: FrameworkLanding = {
  name: "Solid",
  path: "/frameworks/solid",
  eyebrow: "Solid i18n · TypeScript",
  metaTitle: "Solid i18n with TypeScript | Palamedes",
  metaDescription:
    "Add i18n to Solid with TypeScript macros, hook-free client lookup, server-side translation, PO catalogs, and verified locale strategies.",
  headline: "Solid i18n that stays native to Solid.",
  lede: "Palamedes pairs a Vite build integration with dedicated Solid authoring and runtime packages. Solid-native components and hook-free lookups share one catalog model across request-local SSR and hydration.",
  primary: {
    label: "Browse the Solid v2 example",
    href: repoHref("examples/solid-route", "tree"),
  },
  secondary: {
    label: "Read the Solid API guide",
    href: docsHref("api/solid"),
  },
  facts: [
    {
      label: "UI integration",
      value: "@palamedes/solid",
      note: "Solid macros, formatters, and locale primitives.",
    },
    {
      label: "Verified against",
      value: "Solid 2 RC.3+",
      note: "Start Mode, Vite Environment API, Nitro v3, and Vite 8.",
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
    title: "Solid i18n has to cross the server boundary without importing a React mental model.",
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
import solid from "@solidjs/vite-plugin"
import { fileRoutes } from "filesystem-routing/vite"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [
    palamedes({ framework: "solid" }),
    solid({
      extensions: [".jsx", ".tsx"],
      serverFunctions: true,
      ssr: true,
      start: { middleware: "./src/middleware.ts" },
    }),
    fileRoutes(),
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
    matrixSlug: "solid",
    lede: "Solid's file routes and request APIs decide where the locale lives. Each checked Palamedes example keeps the Solid authoring and runtime surface unchanged while swapping the detection and switching policy.",
  },
  proof: {
    title: "Solid behavior is verified, not inferred from the React adapter.",
    lede: "The Solid matrix uses @palamedes/solid directly. Browser checks exercise the rendered page, the locale switch, and localized server work for every URL strategy.",
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
    title: "Current proof targets the Solid 2 release candidate.",
    body: "All four checked examples pin Solid 2.0.0-rc.3 and use the Vite plugin's Start Mode with generated entries, file-system routes, server functions, request middleware, and Nitro v3 output. The matrix verifies the same Palamedes plugin across cookie, route, subdomain, and top-level-domain locale strategies.",
    link: {
      label: "Read the Solid API guide",
      href: docsHref("api/solid"),
    },
  },
  faq: [
    {
      q: "Is Palamedes for Solid a React wrapper?",
      a: "No. @palamedes/solid provides Solid-specific macros, components, formatters, runtime wiring, and client locale helpers. Only the lower catalog and transformation model is shared.",
    },
    {
      q: "Does Solid i18n work during server-side rendering?",
      a: "Yes on the verified Solid 2 RC path. The example activates a server i18n instance before route rendering and initializes the matching client locale for hydration.",
    },
    {
      q: "Can I use route-based locales such as /de/products?",
      a: "Yes. The route example derives the locale from a dynamic Solid segment. Cookie, subdomain, and top-level-domain examples use the same messages and Solid runtime with different resolution policies.",
    },
    {
      q: "Is the Solid 2 release candidate verified?",
      a: "Yes. The matrix pins Solid 2.0.0-rc.3 and exercises Start Mode plus Nitro v3 across all four locale strategies.",
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
      label: "Browse the Solid v2 example",
      href: repoHref("examples/solid-route", "tree"),
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

export default function SolidI18n() {
  return <FrameworkLandingPage page={page} />
}
