import { FrameworkLandingPage } from "~/components/frameworks/FrameworkLandingPage"
import type { FrameworkLanding } from "~/data/framework-landing"
import { docsHref, NPM, repoHref } from "~/data/links"
import { frameworkMeta } from "~/lib/meta"

const page: FrameworkLanding = {
  name: "React Router",
  path: "/frameworks/react-router",
  eyebrow: "React Router i18n · Framework Mode",
  metaTitle: "React Router i18n in Framework Mode | Palamedes",
  metaDescription:
    "Internationalize React Router Framework Mode with TypeScript macros, localized loaders and actions, PO catalogs, SSR, and verified locale switching.",
  headline: "React Router i18n for Framework Mode.",
  lede: "Palamedes connects React Router 8 loaders, actions, SSR, and hydrated React components to one translation runtime. The Vite plugin compiles messages; route modules resolve the locale and activate the matching catalog.",
  primary: {
    label: "Open the React Router demo",
    href: "https://react-router-route.examples.palamedes.dev/en",
  },
  secondary: {
    label: "Browse the TypeScript source",
    href: repoHref("examples/react-router-route", "tree"),
  },
  facts: [
    {
      label: "Mode",
      value: "Framework",
      note: "Type-safe route modules, loaders, actions, and SSR.",
    },
    {
      label: "Verified against",
      value: "React Router 8.3",
      note: "React 19 and the React Router Vite plugin.",
    },
    {
      label: "Integration",
      value: "@palamedes/vite-plugin",
      note: "Macro transforms and PO loading in the route build.",
    },
    {
      label: "Locale models",
      value: "4 examples",
      note: "Cookie, route, subdomain, and top-level domain.",
    },
  ],
  problem: {
    title: "The locale has to be route data, server state, and client state at the right times.",
    lede: "Framework Mode spans the initial server render and later browser navigations. A translated route must activate its locale before loader or action macros run, then hydrate React with the same catalog.",
    points: [
      "Loaders and actions can execute on the server independently, so each boundary must resolve the correct request locale.",
      "The document locale and client runtime must match loader data before HydratedRouter starts.",
      "Route-based, cookie-based, and host-based locale policies should not require different message APIs.",
    ],
  },
  approach: {
    title: "Use route modules for policy and Palamedes for the translation lifecycle.",
    lede: "React Router continues to own matching, redirects, data loading, and mutations. Palamedes supplies transformed authoring, catalogs, request activation, and client synchronization around those APIs.",
    points: [
      {
        title: "Compose two Vite plugins",
        body: "The Palamedes transform runs beside the React Router plugin, so macros and PO imports become normal modules in the Framework Mode build.",
      },
      {
        title: "Activate inside route boundaries",
        body: "A loader or action normalizes its locale and activates the server runtime before translated messages execute.",
      },
      {
        title: "Hydrate from root locale data",
        body: "The root route exposes the resolved locale and the client entry loads the same catalog before React hydrates the document.",
      },
    ],
  },
  code: {
    label: "vite.config.ts + routes/locale-home.tsx",
    caption: "Framework Mode keeps the locale close to the loader and action.",
    source: `// vite.config.ts
import { reactRouter } from "@react-router/dev/vite"
import { palamedes } from "@palamedes/vite-plugin"

export default {
  plugins: [
    palamedes(),
    reactRouter(),
  ],
}

// routes/locale-home.tsx
export async function loader({ params }: Route.LoaderArgs) {
  const locale = normalizeLocale(params.locale)
  activateServerI18n(locale)
  return { locale, title: t\`Welcome to Palamedes\` }
}`,
    note: "The checked route module also localizes an action response. Its client entry activates the locale from root loader data before HydratedRouter hydrates the React tree.",
  },
  strategies: {
    matrixSlug: "react-router",
    lede: "React Router route modules own params, requests, redirects, and links. Palamedes keeps the catalog and component model identical while the four examples change how those route modules derive a locale.",
  },
  proof: {
    title: "Framework Mode is tested as a full server-and-browser application.",
    lede: "The verifier checks the initial document, route or host behavior, client switching, and a localized action after hydration.",
    facts: [
      {
        label: "Route modules",
        value: "Typed",
        note: "The examples use generated loader and action types.",
      },
      {
        label: "Initial response",
        value: "SSR checked",
        note: "Server-rendered messages match the resolved locale.",
      },
      {
        label: "Mutation",
        value: "Action checked",
        note: "A post-hydration action returns localized output.",
      },
      {
        label: "Evidence",
        value: "Live + CI",
        note: "Hosted demos and checked source cover the matrix.",
      },
    ],
  },
  boundary: {
    title: "This page is about React Router Framework Mode, not every router mode.",
    body: "The browser matrix verifies the Vite-powered Framework Mode with SSR, loaders, and actions. Palamedes can be assembled in other Vite React applications, but Declarative and Data Mode do not inherit this page's framework-specific proof automatically.",
    link: {
      label: "Read the framework example notes",
      href: docsHref("framework-example-notes"),
    },
  },
  faq: [
    {
      q: "Where should React Router resolve the locale?",
      a: "At the route or request boundary that owns the policy: a root loader, a locale route loader, middleware, or a shared request helper. Activate the Palamedes server runtime before translated loader or action code executes.",
    },
    {
      q: "Can actions return translated messages?",
      a: "Yes. The checked examples activate the route locale inside the action and return a message produced by a transformed Palamedes macro.",
    },
    {
      q: "Does client navigation keep the active catalog synchronized?",
      a: "Yes in the verified examples. Root locale data initializes the browser runtime before hydration, and the React client helper follows locale changes during navigation and switching.",
    },
    {
      q: "Is React Router Framework Mode the same as Remix v3?",
      a: "No. React Router Framework Mode is a React framework built around route modules and a Vite plugin. The new Remix v3 is a separate server-first full-stack project with its own router, loaders, UI direction, and integration constraints.",
    },
  ],
  related: [
    { label: "Full-stack Remix v3 i18n", href: "/frameworks/remix-v3" },
    { label: "TanStack Start i18n", href: "/frameworks/tanstack-start" },
    { label: "Vite i18n for React and Solid", href: "/frameworks/vite" },
  ],
  finalCta: {
    headline: "Let route modules own the request and one runtime own the messages.",
    primary: {
      label: "Open the live route demo",
      href: "https://react-router-route.examples.palamedes.dev/en",
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

export default function ReactRouterI18n() {
  return <FrameworkLandingPage page={page} />
}
