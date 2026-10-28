import { FrameworkLandingPage } from "~/components/frameworks/FrameworkLandingPage";
import type { FrameworkLanding } from "~/data/framework-landing";
import { docsHref, NPM, repoHref } from "~/data/links";
import { frameworkMeta } from "~/lib/meta";

const page: FrameworkLanding = {
  name: "React Router",
  path: "/frameworks/react-router",
  eyebrow: "React Router i18n · Framework Mode",
  metaTitle: "React Router i18n in Framework Mode | Palamedes",
  metaDescription:
    "Internationalize React Router Framework Mode with TypeScript macros, localized loaders and actions, PO catalogs, SSR, and verified locale switching.",
  headline: "React Router i18n for Framework Mode.",
  lede: "Palamedes connects React Router 8 loaders, actions, SSR, and hydrated React components to one translation runtime. The Vite plugin compiles messages; one root middleware activates the request's catalog for every loader, action, and render.",
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
      value: "React Router 8.5",
      note: "React 19 and the React Router Vite plugin.",
    },
    {
      label: "Integration",
      value: "@palamedes/react-router",
      note: "Root middleware and server entry beside the Vite plugin.",
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
        body: "The Palamedes plugin runs beside the React Router plugin, so macros and the configured PO catalogs compile into normal modules in the Framework Mode build.",
      },
      {
        title: "Activate once, in root middleware",
        body: "React Router 8 route middleware wraps every loader, action, data request, and document render. The adapter's middleware resolves the app's locale policy and activates the server runtime before translated code runs.",
      },
      {
        title: "Hydrate from root locale data",
        body: "The root loader exposes the document locale. The adapter's server entry adds that locale's catalog import map, so compiled messages load before hydration and before lazy route modules run; the client entry hydrates React normally.",
      },
    ],
  },
  code: {
    label: "lib/i18n.server.ts + root.tsx + entry.server.tsx + routes/locale-home.tsx",
    caption: "The app owns the locale policy; the adapter owns the request scope.",
    source: `// app/lib/i18n.server.ts
import { createReactRouterI18n } from "@palamedes/react-router"
import { resolveLocaleFromRequest } from "./i18n"

export const i18n = createReactRouterI18n({
  resolveLocale: resolveLocaleFromRequest,
  i18nOptions: { timeZone: "Europe/Berlin" },
})

// app/root.tsx
export const middleware = [i18n.middleware]

// app/entry.server.tsx
export default i18n.handleRequest

// app/routes/locale-home.tsx
export async function action({ params }: Route.ActionArgs) {
  const locale = normalizeLocale(params.locale)
  return { message: t\`Server action confirmed locale \${locale}.\` }
}`,
    note: "Loaders and actions need no wrapper: the root middleware gives each request its own i18n instance over a shared server catalog. The server entry injects the locale's catalog import map; the client entry calls HydratedRouter without an application-owned catalog loader.",
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
      a: "In the resolveLocale function passed to createReactRouterI18n. It receives the request, so it can read a cookie, a path segment, or the host. The adapter's root middleware calls it once per request and activates the matching catalog before loaders and actions run.",
    },
    {
      q: "Can actions return translated messages?",
      a: "Yes. The root middleware also covers actions, so an action can return a message produced by a transformed Palamedes macro without any wrapper.",
    },
    {
      q: "Does client navigation keep the active catalog synchronized?",
      a: "The adapter loads active-document-locale fragments before hydration and lazy route execution. Language changes navigate to a new document so root locale data, server rendering, and browser messages remain aligned.",
    },
    {
      q: "Is React Router Framework Mode the same as Remix?",
      a: "No. React Router Framework Mode is a React framework built around route modules and a Vite plugin. The new Remix is a separate server-first full-stack project with its own router, loaders, UI direction, and integration constraints.",
    },
  ],
  related: [
    { label: "Full-stack Remix i18n", href: "/frameworks/remix-v3" },
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
      label: "View @palamedes/react-router",
      href: NPM("@palamedes/react-router"),
    },
  },
};

export const handle = { layout: "bare" };

export function meta() {
  return frameworkMeta({
    title: page.metaTitle,
    description: page.metaDescription,
    path: page.path,
    framework: page.name,
    faq: page.faq,
  });
}

export default function ReactRouterI18n() {
  return <FrameworkLandingPage page={page} />;
}
