import { FrameworkLandingPage } from "~/components/frameworks/FrameworkLandingPage";
import type { FrameworkLanding } from "~/data/framework-landing";
import { docsHref, NPM, repoHref } from "~/data/links";
import { frameworkMeta } from "~/lib/meta";

const page: FrameworkLanding = {
  name: "Remix v3",
  path: "/frameworks/remix-v3",
  eyebrow: "Remix v3 i18n · Server and browser",
  metaTitle: "Full-stack Remix v3 i18n | Palamedes",
  metaDescription:
    "Add full-stack i18n to Remix v3 with server and browser macro transforms, request-local catalogs, rich Remix messages, and document-safe client bootstrap.",
  headline: "Remix v3 i18n, from the request to the browser.",
  lede: "The new Remix v3 is not React Router Framework Mode and it is not a React framework. Palamedes composes with its Node TypeScript loader, browser asset server, Fetch request model, and Remix component runtime so one locale reaches SSR, Frames, hydration, and interaction.",
  primary: {
    label: "Browse the full-stack example",
    href: repoHref("examples/remix-cookie", "tree"),
  },
  secondary: {
    label: "Read the complete setup",
    href: docsHref("api/remix"),
  },
  facts: [
    {
      label: "Integration",
      value: "Node + assets",
      note: "Post-compile transforms for server and browser modules.",
    },
    {
      label: "Verified against",
      value: "Remix 3.0.0",
      note: "Exact example pin with smoke and Chromium verification.",
    },
    {
      label: "Current scope",
      value: "Full stack",
      note: "Server scope, browser macros, rich messages, and catalog bootstrap.",
    },
    {
      label: "Locale models",
      value: "4 browser proofs",
      note: "Cookie, route, subdomain, and TLD with browser verification.",
    },
  ],
  problem: {
    title: "Remix v3 splits full-stack compilation across two post-compile loaders.",
    lede: "Server TypeScript flows through Node while browser modules flow through the asset server. A complete integration must transform both outputs, keep request state isolated, and install the matching catalog before translated client code runs.",
    points: [
      "A transform hook must run after remix/node-tsx without allowing uncompiled macro stubs to reach runtime.",
      "The asset loader must preserve Remix's TS/TSX source-map chain, import rewriting, HMR analysis, and minification.",
      "Fetch requests, streamed Frames, SSR markup, and the browser bootstrap must agree on one request-local locale.",
    ],
  },
  approach: {
    title: "Join both Remix loaders, then carry one locale through the document.",
    lede: "Palamedes transforms the JavaScript Remix already compiled, shares immutable server catalogs, and delivers executable active-locale fragments through the asset server before translated browser modules run.",
    points: [
      {
        title: "A composable Node loader",
        body: "Register remix/node-tsx first and @palamedes/remix/register second. Macro-containing server modules are transformed once when Node loads them.",
      },
      {
        title: "A post-compile asset loader",
        body: "createPalamedesRemixAssetLoader() transforms ordinary and rich browser macros before Remix resolves imports, HMR boundaries, source maps, and minification.",
      },
      {
        title: "Shared registry, automatic browser delivery",
        body: "One catalog asset registry serves both the server scope and browser loader. The adapter derives message dependencies and initializes browser delivery; application code supplies locale policy and ordinary error UI.",
      },
    ],
  },
  code: {
    label: "server catalog and asset configuration",
    caption: "Connect server catalogs and browser fragments through one registry.",
    source: `// package.json
{
  "scripts": {
    "start": "node --import remix/node-tsx --import @palamedes/remix/register server.ts"
  }
}

// server.ts
import {
  createPalamedesRemixAssetLoader,
  createPalamedesRemixCatalogAssetRegistry,
  PALAMEDES_REMIX_ASSET_PACKAGES,
} from "@palamedes/remix"
import { defineLocaleControls } from "@palamedes/core/locale"
import { createRemixI18nServer } from "@palamedes/remix/server"
import { createAssetServer } from "remix/assets"

const catalogAssets = createPalamedesRemixCatalogAssetRegistry()
const remixI18n = createRemixI18nServer({
  locales: defineLocaleControls({ locales: ["en", "de"], defaultLocale: "en" }),
  strategy: "cookie",
  catalogAssets: { registry: catalogAssets },
})

const assets = createAssetServer({
  basePath: "/assets",
  allowFiles: ["app/**/public/**"],
  allowPackages: ["remix", ...PALAMEDES_REMIX_ASSET_PACKAGES],
  sourceMaps: process.env.NODE_ENV === "development" ? "external" : undefined,
  scripts: {
    loaders: [createPalamedesRemixAssetLoader({ catalogAssets })],
  },
})

// Serve catalogAssets.serve(request) and remixI18n.serveClientCatalogAsset(request)
// before assets.fetch(request) under the asset namespace.`,
    note: "The full example renders remixI18n.renderClientCatalog(locale) and await renderClientEntry(entryPath, { assetServer }) inside the request scope. The adapter loads dependencies and imports the application entry. Rich messages use @palamedes/remix/macro; initial and lazy delivery failures reach ordinary error UI.",
  },
  strategies: {
    matrixSlug: "remix",
    lede: "The same server helper supports cookie, route, subdomain, and TLD decisions. Every strategy verifies SSR, browser macros and rich messages, interaction, Frames, locale navigation, reloads, and catalog failure recovery under CSP.",
  },
  proof: {
    title: "Four complete server and browser proofs.",
    lede: "Remix v3 remains separate from React Router Framework Mode. CI starts all four locale-strategy servers and runs Chromium against every strategy with SSR, hydration, rich messages, interaction, and locale navigation.",
    facts: [
      {
        label: "Transforms",
        value: "Server + browser",
        note: "Ordinary and rich macros are checked after Remix compilation.",
      },
      {
        label: "Catalog path",
        value: "Compiled ESM",
        note: "Active-locale fragments and parser-free browser delivery are checked.",
      },
      {
        label: "Remix components",
        value: "Rich + Frames",
        note: "Rich elements, streamed Frames, and direct frame requests are covered.",
      },
      {
        label: "Hosting",
        value: "Local / CI",
        note: "No public Remix v3 demo is claimed yet.",
      },
    ],
  },
  boundary: {
    title: "The browser locale is document-scoped, and public hosting is still pending.",
    body: "Locale changes intentionally perform a full document navigation; reactive same-document catalog replacement and browser PO imports are not supported. The Node integration requires Node.js 24.3 or newer. Source, smoke checks, and the Chromium proof are public, but no live URL is claimed until the separately managed HTTPS deployment passes the same locale, hydration, Frames, interaction, and console checks.",
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
      a: "Yes. The integration uses Remix components rather than React. It transforms ordinary core macros plus Remix-native Trans, Plural, Select, and SelectOrdinal components in server and browser modules.",
    },
    {
      q: "Can Remix v3 browser modules use Palamedes macros?",
      a: "Yes. Share one createPalamedesRemixCatalogAssetRegistry() between the server and asset loader, allow PALAMEDES_REMIX_ASSET_PACKAGES, and render the adapter's client entry. It loads active-locale fragments before translated modules run; browser PO imports remain unsupported.",
    },
    {
      q: "Is Remix v3 support production-ready?",
      a: "Treat it as a preview integration for the exact tested Remix 3.0.0 contract. Full-stack behavior is CI-verified, including Chromium, with stable upstream Remix, while public hosted-demo verification is still pending.",
    },
  ],
  related: [
    { label: "React Router i18n in Framework Mode", href: "/frameworks/react-router" },
    { label: "Vite i18n for React and Solid", href: "/frameworks/vite" },
    { label: "Next.js App Router i18n", href: "/frameworks/nextjs" },
  ],
  finalCta: {
    headline: "Follow one Remix locale from the request through browser interaction.",
    primary: {
      label: "Browse the cookie example",
      href: repoHref("examples/remix-cookie", "tree"),
    },
    secondary: {
      label: "View @palamedes/remix",
      href: NPM("@palamedes/remix"),
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

export default function RemixV3I18n() {
  return <FrameworkLandingPage page={page} />;
}
