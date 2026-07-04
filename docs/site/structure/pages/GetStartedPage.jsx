/**
 * Route: /get-started
 * Job: remove every excuse not to try it. Mirrors
 * docs/first-working-translation.md but web-native: copy buttons, a stack
 * picker, and honest notes about what doesn't exist yet (no top-level
 * `palamedes` package). Ends with "where to go next", not a dead end.
 */

export function GetStartedPage() {
  return (
    <Page title="Get started with Palamedes in 5 minutes">
      <SiteNav />

      <Hero
        eyebrow="Quickstart"
        headline="First working translation in 5 minutes."
        subline="One translated component, one extraction run, one .po file,
          one runtime instance. No message IDs to invent, no dictionary files
          to maintain."
        primary={{ label: "Skip to step 1", href: "#install" }}
        secondary={{
          label: "Full written guide",
          href: "…/docs/first-working-translation.md",
        }}
      />

      {/* Stack picker switches all code blocks below between React and
          Solid via tabs — one page, no duplicated flow. */}
      <StackPicker options={["Vite + React", "Vite + Solid", "Next.js"]} />

      <Callout tone="honest">
        Heads-up: install the scoped <code>@palamedes/*</code> packages. The top-level{" "}
        <code>palamedes</code> and <code>create-palamedes</code> names are reserved for a future
        one-command setup and are not the entry point today.
      </Callout>

      <StepFlow
        steps={[
          {
            title: "Install",
            body: "Core, runtime, host adapter, and the build plugin — plus the CLI as a dev dependency.",
            code: `
pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli @vitejs/plugin-react`,
          },
          {
            title: "Configure",
            body: "One YAML file declares your locales and where catalogs live.",
            code: `
# palamedes.yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]`,
          },
          {
            title: "Wire the plugin & runtime",
            body: "The Vite plugin handles the macro transform; the runtime holds the active i18n instance.",
            code: `
// vite.config.ts
import { palamedes } from "@palamedes/vite-plugin"
export default defineConfig({ plugins: [palamedes(), react()] })

// src/i18n.ts
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"
setClientI18n(createI18n())`,
          },
          {
            title: "Write, extract, translate",
            body: "Author the message in your component, run one command, fill in the German string.",
            code: `
// src/App.tsx
import { t } from "@palamedes/core/macro"
export const App = () => <h1>{t\`Welcome to Palamedes\`}</h1>

$ pmds extract`,
          },
        ]}
      />

      {/* ------------------------------------------------------ next steps */}
      <Section id="next">
        <h2>Where to go from here</h2>
        <FeatureGrid
          columns={3}
          cards={[
            {
              icon: "book",
              title: "Plurals, dates & currency",
              body: "ICU MessageFormat with authoring diagnostics that catch mistakes at extract time.",
              href: "…/docs/api/core.md",
            },
            {
              icon: "compass",
              title: "Pick a locale strategy",
              body: "Cookie, route, subdomain, or TLD — with a live demo for each, in your framework.",
              href: "/frameworks",
            },
            {
              icon: "server",
              title: "Localize your backend",
              body: "Request-local i18n for Hono and Express from the same catalogs.",
              href: "…/docs/backend-servers.md",
            },
            {
              icon: "arrows",
              title: "Migrating from Lingui?",
              body: "A step-by-step playbook — most teams keep their .po files as-is.",
              href: "…/docs/migrate-from-lingui.md",
            },
            {
              icon: "wrench",
              title: "Something broke?",
              body: "The troubleshooting guide covers the common setup failures with exact error messages.",
              href: "…/docs/troubleshooting.md",
            },
            {
              icon: "robot",
              title: "Using an AI assistant?",
              body: "Point it at llms.txt — the whole API surface in one machine-readable file.",
              href: "…/llms.txt",
            },
          ]}
        />
      </Section>

      <CtaBand
        headline="Stuck? The maintainer reads every issue."
        primary={{
          label: "Open an issue",
          href: "https://github.com/sebastian-software/palamedes/issues",
        }}
        secondary={{ label: "Read the docs", href: "…/docs/api/README.md" }}
      />

      <SiteFooter />
    </Page>
  )
}
