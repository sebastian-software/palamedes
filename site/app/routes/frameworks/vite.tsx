import { FrameworkLandingPage } from "~/components/frameworks/FrameworkLandingPage"
import type { FrameworkLanding } from "~/data/framework-landing"
import { docsHref, NPM, repoHref } from "~/data/links"
import { frameworkMeta } from "~/lib/meta"

const page: FrameworkLanding = {
  name: "Vite",
  path: "/frameworks/vite",
  eyebrow: "Vite i18n · React and Solid",
  metaTitle: "Vite i18n for React and Solid | Palamedes",
  metaDescription:
    "Add i18n to Vite with TypeScript macros, React or Solid runtime packages, PO catalogs, native transforms, extraction, and build-time diagnostics.",
  headline: "Vite i18n for React and Solid, in one plugin.",
  lede: "Add Palamedes beside your renderer plugin and keep translation authoring inside TypeScript. The Vite adapter transforms macros, compiles imported PO catalogs, and reports catalog problems during development and production builds.",
  primary: {
    label: "Use the 5-minute setup",
    href: docsHref("first-working-translation"),
  },
  secondary: {
    label: "Browse the plugin source",
    href: repoHref("packages/vite-plugin", "tree"),
  },
  facts: [
    {
      label: "Integration",
      value: "@palamedes/vite-plugin",
      note: "One transform and catalog loader for Vite projects.",
    },
    {
      label: "Renderer packages",
      value: "React + Solid",
      note: "Choose the runtime module that matches the UI.",
    },
    {
      label: "Version range",
      value: "Vite 3–8",
      note: "The current matrix itself runs on Vite 8.",
    },
    {
      label: "Catalog workflow",
      value: "PO + FCL",
      note: "PO imports today; PO or FCL for CLI catalog storage.",
    },
  ],
  problem: {
    title: "Vite supplies a fast module pipeline, not an internationalization architecture.",
    lede: "A useful Vite i18n setup still needs an authoring model, extraction, catalogs, ICU validation, renderer integration, and an active runtime. Adding unrelated plugins for each step creates boundaries that fail at different times.",
    points: [
      "Message syntax has to transform before React or Solid consumes the TypeScript module.",
      "Catalog imports need to become executable modules while missing or invalid translations remain visible during builds.",
      "The browser runtime, extraction CLI, and catalog updater must agree on message identity instead of defining separate formats.",
    ],
  },
  approach: {
    title: "Use Vite as the host for a complete local i18n workflow.",
    lede: "The plugin is only the build boundary. Palamedes connects it to the same native transform, catalog engine, runtime contract, and CLI used by the framework adapters.",
    points: [
      {
        title: "Transform before the renderer",
        body: "Place palamedes() before the React plugin, or add it to SolidStart's Vite configuration with the Solid runtime module.",
      },
      {
        title: "Choose a renderer, not a new model",
        body: "@palamedes/react and @palamedes/solid expose renderer-specific macros and client helpers over the same catalog semantics.",
      },
      {
        title: "Keep extraction out of the browser build",
        body: "The native pmds CLI extracts and updates catalogs explicitly, while Vite focuses on turning application modules into runnable code.",
      },
    ],
  },
  code: {
    label: "vite.config.ts",
    caption: "The only difference between React and Solid is the renderer boundary.",
    source: `// React
import react from "@vitejs/plugin-react"
import { palamedes } from "@palamedes/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    palamedes({ runtimeModule: "@palamedes/react/runtime" }),
    react(),
  ],
})

// Solid
import solid from "vite-plugin-solid"

export default defineConfig({
  plugins: [
    palamedes({ runtimeModule: "@palamedes/solid/runtime" }),
    solid(),
  ],
})`,
    note: "Both paths use TypeScript macros, the same palamedes.yaml format, and the same extraction CLI. The renderer package supplies rich-message and client-locale primitives where the UI models differ.",
  },
  strategies: {
    lede: "Vite does not prescribe routing or server request APIs. Cookie, route, subdomain, and top-level-domain locale policies remain application concerns; Palamedes keeps the translation pipeline stable underneath whichever policy your React or Solid host implements.",
  },
  proof: {
    title: "The plugin is exercised through several full-stack hosts, not just a fixture.",
    lede: "TanStack Start, SolidStart, Waku, and React Router use @palamedes/vite-plugin throughout the browser-verified framework matrix. Package tests cover the transform and loader boundary directly.",
    facts: [
      {
        label: "React hosts",
        value: "3 families",
        note: "TanStack Start, Waku, and React Router.",
      },
      {
        label: "Solid hosts",
        value: "1 family",
        note: "SolidStart uses the Solid runtime integration.",
      },
      {
        label: "Build behavior",
        value: "Dev + build",
        note: "The same plugin handles transforms and PO imports.",
      },
      {
        label: "Diagnostics",
        value: "Native",
        note: "Macro, placeholder, and ICU problems surface early.",
      },
    ],
  },
  boundary: {
    title: "Vite support does not mean every Vite renderer is supported.",
    body: "Palamedes currently ships public UI packages for React and Solid. Vue, Svelte, Preact, Lit, and other Vite templates do not receive a renderer adapter merely because the build plugin can transform TypeScript. Direct application catalog imports currently use PO files.",
    link: {
      label: "Read the Vite plugin guide",
      href: docsHref("api/vite-plugin"),
    },
  },
  faq: [
    {
      q: "Does Vite have built-in internationalization?",
      a: "No. Vite supplies a development server, module transforms, and production builds. Palamedes adds message authoring, catalog loading, extraction, validation, runtime access, and renderer integrations on top of that pipeline.",
    },
    {
      q: "Should the Palamedes plugin run before the React or Solid plugin?",
      a: "Yes. Put palamedes() before the renderer plugin so message macros are transformed while their original TypeScript and JSX structure is still available.",
    },
    {
      q: "Does Palamedes type-check my Vite application?",
      a: "No. Like Vite itself, the plugin transforms source modules rather than running whole-program type checking. Keep tsc --noEmit or your existing type-check command in development and CI.",
    },
    {
      q: "Can I use Palamedes with Vue or Svelte?",
      a: "Not as a supported end-to-end UI integration today. The build plugin is Vite-based, but public authoring and client runtime packages currently target React and Solid.",
    },
  ],
  related: [
    { label: "TanStack Start i18n", href: "/frameworks/tanstack-start" },
    { label: "SolidStart i18n", href: "/frameworks/solidstart" },
    { label: "React Router i18n in Framework Mode", href: "/frameworks/react-router" },
  ],
  finalCta: {
    headline: "Add one Vite plugin, then keep the whole translation workflow coherent.",
    primary: {
      label: "Try the TypeScript quickstart",
      href: docsHref("first-working-translation"),
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

export default function ViteI18n() {
  return <FrameworkLandingPage page={page} />
}
