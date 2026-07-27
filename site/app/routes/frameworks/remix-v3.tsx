import { FrameworkLandingPage } from "~/components/frameworks/FrameworkLandingPage"
import type { FrameworkLanding } from "~/data/framework-landing"
import { docsHref, NPM, repoHref } from "~/data/links"
import { frameworkMeta } from "~/lib/meta"

const page: FrameworkLanding = {
  name: "Remix v3",
  path: "/frameworks/remix-v3",
  eyebrow: "Remix v3 i18n · Server-first",
  metaTitle: "Remix v3 i18n for server-first apps | Palamedes",
  metaDescription:
    "Add server-first i18n to the new Remix v3 with TypeScript macros, request-local catalogs, a Node loader integration, and four smoke-verified locale strategies.",
  headline: "Remix v3 i18n for its new server-first stack.",
  lede: "The new Remix v3 is not React Router Framework Mode and it is not a React framework. Palamedes integrates with its Node TypeScript loader and Fetch API request model to translate server-loaded modules with request-local PO catalogs.",
  primary: {
    label: "Browse the Remix v3 example",
    href: repoHref("examples/remix-route", "tree"),
  },
  secondary: {
    label: "Read the current limitations",
    href: docsHref("api/remix"),
  },
  facts: [
    {
      label: "Integration",
      value: "@palamedes/remix",
      note: "A Node loader hook plus request-local server helpers.",
    },
    {
      label: "Verified against",
      value: "Remix 3 beta.5",
      note: "The new full-stack Remix package, not React Router.",
    },
    {
      label: "Current scope",
      value: "Server modules",
      note: "TypeScript macros and PO imports on the server path.",
    },
    {
      label: "Locale models",
      value: "4 smoke proofs",
      note: "Cookie, route, subdomain, and top-level domain.",
    },
  ],
  problem: {
    title: "Remix v3 moved the integration point from a bundler to the running server.",
    lede: "Remix v3 intentionally executes TypeScript through its Node loader instead of relying on a traditional application build. Translation macros therefore have to compose with that loader and establish request scope before controllers render a response.",
    points: [
      "A transform hook must run after remix/node-tsx without allowing uncompiled macro stubs to reach runtime.",
      "Fetch API requests need isolated locale state while several requests share one Node process.",
      "Server-loaded modules and browser assets currently expose different extension points and cannot be presented as one finished adapter.",
    ],
  },
  approach: {
    title: "Join the loader Remix already uses, then stay request-local.",
    lede: "Palamedes does not add a separate Remix build. Its register hook receives the output from Remix's TypeScript loader, transforms message macros, and lets controllers resolve catalogs through a server helper.",
    points: [
      {
        title: "A composable Node loader",
        body: "Register remix/node-tsx first and @palamedes/remix/register second. Macro-containing server modules are transformed once when Node loads them.",
      },
      {
        title: "Fetch-native locale resolution",
        body: "createRemixI18nServer() reads a Request, applies the chosen strategy, loads the catalog, and scopes the active runtime to the handler.",
      },
      {
        title: "No per-request transform work",
        body: "After process startup, handlers execute ordinary runtime calls against compiled catalogs; the transform does not repeat for every response.",
      },
    ],
  },
  code: {
    label: "package.json + app/i18n.ts",
    caption: "Loader order is explicit; locale policy stays in a typed server helper.",
    source: `// package.json
{
  "scripts": {
    "start": "node --import remix/node-tsx --import @palamedes/remix/register server.ts"
  }
}

// app/i18n.ts
import { createRemixI18nServer } from "@palamedes/remix/server"

export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "route",
  loadMessages,
  routeParam: "locale",
})

export function resolveLocale(request: Request) {
  return remixI18n.resolveLocale(request)
}`,
    note: "The registration order is load-bearing: Remix lowers TypeScript first, then Palamedes transforms the resulting server module. The checked controller runs translated t and plural calls inside the resolved request scope.",
  },
  strategies: {
    matrixSlug: "remix",
    lede: "The Remix server helper supports the same four locale decisions as the established UI adapters. These examples are local and CI smoke proofs today; the cells link source rather than implying a public interactive deployment.",
  },
  proof: {
    title: "Four server proofs, with the maturity level stated plainly.",
    lede: "Remix v3 support is checked separately from React Router and separately from the browser-verified React/Solid matrix. The tests start each server and assert locale-specific responses and switching behavior.",
    facts: [
      {
        label: "Module loading",
        value: "Hook checked",
        note: "TypeScript macros are transformed after remix/node-tsx.",
      },
      {
        label: "Catalog loading",
        value: "PO checked",
        note: "Server-loaded PO imports compile through the register hook.",
      },
      {
        label: "Request state",
        value: "Scoped",
        note: "Locale and catalog resolve per Fetch API request.",
      },
      {
        label: "Hosting",
        value: "Local / CI",
        note: "No public Remix v3 demo is claimed yet.",
      },
    ],
  },
  boundary: {
    title: "Server modules work today; client modules and rich JSX do not.",
    body: "The current Remix asset pipeline does not expose the script transform hook Palamedes needs for browser-delivered modules. Remix also lowers JSX before the register hook sees it, so rich JSX messages are not supported on this path. The integration requires Node.js 24.3 or newer.",
    link: {
      label: "Read the Remix v3 package scope",
      href: docsHref("api/remix"),
    },
  },
  faq: [
    {
      q: "Is Remix v3 the same thing as React Router Framework Mode?",
      a: "No. React Router Framework Mode remains a React framework with a Vite plugin, route modules, loaders, and actions. Remix v3 is a separate server-first full-stack project with its own packages, router, loaders, UI direction, and runtime model.",
    },
    {
      q: "Does Palamedes support Remix v3 without React?",
      a: "Yes for the current server-loaded module path. The integration transforms core t, plural, select, and selectOrdinal macros and loads PO catalogs without depending on @palamedes/react.",
    },
    {
      q: "Can Remix v3 browser modules use Palamedes macros?",
      a: "Not yet. Remix's current asset pipeline does not expose a script transform hook for the Palamedes adapter, so this page deliberately limits the support claim to server-loaded modules.",
    },
    {
      q: "Is Remix v3 support production-ready?",
      a: "Treat it as an early integration for an upstream beta. Four locale strategies are smoke-verified, but there is no public hosted demo, client-module transform, or rich JSX path yet.",
    },
  ],
  related: [
    { label: "React Router i18n in Framework Mode", href: "/frameworks/react-router" },
    { label: "Vite i18n for React and Solid", href: "/frameworks/vite" },
    { label: "Next.js App Router i18n", href: "/frameworks/nextjs" },
  ],
  finalCta: {
    headline: "Explore the new Remix on its own terms, including the sharp edges.",
    primary: {
      label: "Browse the route example",
      href: repoHref("examples/remix-route", "tree"),
    },
    secondary: {
      label: "View @palamedes/remix",
      href: NPM("@palamedes/remix"),
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

export default function RemixV3I18n() {
  return <FrameworkLandingPage page={page} />
}
