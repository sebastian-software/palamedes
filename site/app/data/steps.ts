/* Get-started step flow, verbatim from docs/site/structure/pages/GetStartedPage.jsx. */

export interface Step {
  title: string
  body: string
  code?: string
  aside?: string
}

export const QUICKSTART_STEPS: Step[] = [
  {
    title: "Install",
    body: "Core, runtime, host adapter, and the build plugin — plus the CLI as a dev dependency.",
    code: `pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli @vitejs/plugin-react`,
  },
  {
    title: "Configure",
    body: "One YAML file declares your locales and where catalogs live.",
    code: `# palamedes.yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]`,
  },
  {
    title: "Wire the plugin & runtime",
    body: "The Vite plugin handles the macro transform; the runtime holds the active i18n instance.",
    code: `// vite.config.ts
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
    code: `// src/App.tsx
import { t } from "@palamedes/core/macro"
export const App = () => <h1>{t\`Welcome to Palamedes\`}</h1>

$ pmds extract`,
  },
  {
    title: "Translate",
    body: "Open the German catalog and fill in the translated string.",
    code: `# src/locales/de.po
msgid "Welcome to Palamedes"
msgstr "Willkommen bei Palamedes"`,
  },
  {
    title: "Load & see it render",
    body: "Load the catalogs, activate a locale, and run the dev server — the page now renders “Willkommen bei Palamedes”. That is the full local loop: transform, extraction, catalog, runtime.",
    aside:
      'TypeScript needs an ambient declaration for .po imports — add a src/po.d.ts with `declare module "*.po"` (see the troubleshooting guide).',
    code: `// src/main.tsx
import { i18n } from "./i18n"
import { messages as enMessages } from "./locales/en.po"
import { messages as deMessages } from "./locales/de.po"

i18n.load("en", enMessages)
i18n.load("de", deMessages)
i18n.activate("de")

$ pnpm dev`,
  },
]

export const PIPELINE = ["write", "extract", "translate", "render"]
