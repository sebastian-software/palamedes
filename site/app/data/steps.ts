/* Get-started step flow, verbatim from docs/site/structure/pages/GetStartedPage.jsx. */

export interface Step {
  title: string
  body: string
  code?: string
  aside?: string
}

export type StackId = "react" | "solid" | "next"

export const STACKS: Array<{ id: StackId; label: string }> = [
  { id: "react", label: "Vite + React" },
  { id: "solid", label: "Vite + Solid" },
  { id: "next", label: "Next.js" },
]

const PO_DECLARATION = `// src/po.d.ts
declare module "*.po" {
  import type { CatalogMessages } from "@palamedes/core"

  export const messages: CatalogMessages
}`

export const QUICKSTART_STEPS: Record<StackId, Step[]> = {
  react: [
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
  ],
  solid: [
    {
      title: "Install",
      body: "Core, runtime, Solid adapter, and the Vite plugin — plus the CLI as a dev dependency.",
      code: `pnpm add @palamedes/core @palamedes/solid @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli vite-plugin-solid`,
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
import solid from "vite-plugin-solid"
export default defineConfig({ plugins: [palamedes(), solid()] })

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
import { Trans } from "@palamedes/solid/macro"
export const App = () => <h1><Trans>Welcome to Palamedes</Trans></h1>

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
      body: "Load the catalogs, activate a locale, and run the dev server — the page now renders “Willkommen bei Palamedes”.",
      aside:
        'TypeScript needs an ambient declaration for .po imports — add src/po.d.ts with `declare module "*.po"`.',
      code: `${PO_DECLARATION}

// src/main.tsx
import { render } from "solid-js/web"
import { i18n } from "./i18n"
import { App } from "./App"
import { messages as enMessages } from "./locales/en.po"
import { messages as deMessages } from "./locales/de.po"

i18n.load("en", enMessages)
i18n.load("de", deMessages)
i18n.activate("de")

render(() => <App />, document.getElementById("root")!)

$ pnpm dev`,
    },
  ],
  next: [
    {
      title: "Install",
      body: "Core, runtime, React adapter, and the Next plugin — plus the CLI as a dev dependency.",
      code: `pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/next-plugin
pnpm add -D @palamedes/cli @palamedes/config`,
    },
    {
      title: "Configure",
      body: "One YAML file declares your locales and where catalogs live.",
      code: `# palamedes.yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [app, src]`,
    },
    {
      title: "Wire the plugin & runtime",
      body: "The Next plugin handles macro transform and .po loading; server code binds request-local i18n before macros run.",
      code: `// next.config.mjs
import { withPalamedes } from "@palamedes/next-plugin"
export default withPalamedes({})

// src/lib/i18n.server.ts
import "server-only"
import { createI18n } from "@palamedes/core"
import { createServerI18nScope } from "@palamedes/runtime/server"

export const serverI18n = createServerI18nScope<ReturnType<typeof createI18n>>()`,
    },
    {
      title: "Write & extract",
      body: "Author the message in a Server Component after activating the server i18n scope, then run extraction.",
      code: `// app/page.tsx
import { t } from "@palamedes/core/macro"
export default function Page() {
  return <h1>{t\`Welcome to Palamedes\`}</h1>
}

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
      body: "Load the catalogs in server code, activate the request scope, and run Next.js.",
      aside:
        'TypeScript needs an ambient declaration for .po imports — add src/po.d.ts with `declare module "*.po"`.',
      code: `${PO_DECLARATION}

// src/lib/load-i18n.server.ts
import { createI18n } from "@palamedes/core"
import { serverI18n } from "./i18n.server"
import { messages as enMessages } from "../locales/en.po"
import { messages as deMessages } from "../locales/de.po"

export function activateServerI18n(locale: "en" | "de") {
  const i18n = createI18n()
  i18n.load("en", enMessages)
  i18n.load("de", deMessages)
  i18n.activate(locale)
  serverI18n.activate(i18n)
}

$ pnpm dev`,
    },
  ],
}

export const PIPELINE = ["write", "extract", "translate", "render"]
