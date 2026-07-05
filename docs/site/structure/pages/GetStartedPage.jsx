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
          href: repoHref("docs/first-working-translation.md"),
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

export const i18n = createI18n()
setClientI18n(i18n)`,
          },
          {
            title: "Write & extract",
            body: "Author the message in your component, then run one command — it creates src/locales/en.po and de.po.",
            code: `
// src/App.tsx
import { t } from "@palamedes/core/macro"
export const App = () => <h1>{t\`Welcome to Palamedes\`}</h1>

$ pmds extract`,
          },
          {
            title: "Translate",
            body: "Open the German catalog and fill in the translated string.",
            code: `
# src/locales/de.po
msgid "Welcome to Palamedes"
msgstr "Willkommen bei Palamedes"`,
          },
          {
            title: "Load & see it render",
            body: "Load the catalogs, activate a locale, and run the dev server — the page now renders “Willkommen bei Palamedes”. That is the full local loop: transform, extraction, catalog, runtime.",
            aside:
              'TypeScript needs an ambient declaration for .po imports — add a src/po.d.ts with `declare module "*.po"` (see the troubleshooting guide).',
            code: `
// src/main.tsx
import { i18n } from "./i18n"
import { messages as enMessages } from "./locales/en.po"
import { messages as deMessages } from "./locales/de.po"

i18n.load("en", enMessages)
i18n.load("de", deMessages)
i18n.activate("de")

$ pnpm dev`,
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
              href: repoHref("docs/api/core.md"),
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
              href: repoHref("docs/backend-servers.md"),
            },
            {
              icon: "arrows",
              title: "Migrating from Lingui?",
              body: "A step-by-step playbook. Source-string-first .po catalogs are often reusable after an extraction pass; explicit-ID setups need cleanup.",
              href: repoHref("docs/migrate-from-lingui.md"),
            },
            {
              icon: "wrench",
              title: "Something broke?",
              body: "The troubleshooting guide covers the common setup failures with exact error messages.",
              href: repoHref("docs/troubleshooting.md"),
            },
            {
              icon: "robot",
              title: "Using an AI assistant?",
              body: "Point it at llms.txt — the whole API surface in one machine-readable file.",
              href: repoHref("llms.txt"),
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
        secondary={{ label: "Read the docs", href: repoHref("docs/api/README.md") }}
      />

      <SiteFooter />
    </Page>
  )
}
