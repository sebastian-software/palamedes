interface InstructionStep {
  kind?: undefined;
  title: string;
  body: string;
  code?: string;
  aside?: string;
}

interface PackageBoundaryStep {
  kind: "package-boundary";
  title: string;
}

export type Step = InstructionStep | PackageBoundaryStep;

export type StackId = "react" | "solid" | "next";

export const STACKS: Array<{ id: StackId; label: string }> = [
  { id: "react", label: "Vite + React" },
  { id: "solid", label: "Vite + Solid" },
  { id: "next", label: "Next.js" },
];

export const PACKAGE_BOUNDARY_STEP: PackageBoundaryStep = {
  kind: "package-boundary",
  title: "Use the scoped packages",
};

export const QUICKSTART_STEPS: Record<StackId, Step[]> = {
  react: [
    {
      title: "Install",
      body: "Core, runtime, host adapter, and the build plugin — plus the CLI as a dev dependency.",
      code: `pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli @vitejs/plugin-react`,
    },
    PACKAGE_BOUNDARY_STEP,
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
      body: "The Vite adapter owns the parser-free runtime and derives the active locale's compiled catalog dependency before translated code runs.",
      code: `// vite.config.ts
import { palamedes } from "@palamedes/vite-plugin"
export default defineConfig({ plugins: [palamedes(), react()] })

// index.html
<html lang="de"></html>`,
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
      title: "See it render",
      body: "The adapter derives and loads the active locale's compiled fragment before translated code runs — the page now renders “Willkommen bei Palamedes”.",
      aside:
        "No app-owned catalog map, locale import, or runtime loader is required in the standard flow.",
      code: `$ pnpm dev`,
    },
  ],
  solid: [
    {
      title: "Install",
      body: "Core, runtime, Solid adapter, and the Vite plugin — plus the CLI as a dev dependency.",
      code: `pnpm add @palamedes/core @palamedes/solid @palamedes/runtime @palamedes/vite-plugin @solidjs/web solid-js
pnpm add -D @palamedes/cli @solidjs/vite-plugin`,
    },
    PACKAGE_BOUNDARY_STEP,
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
      body: "The Vite adapter owns the parser-free runtime and derives the active locale's compiled catalog dependency before translated code runs.",
      code: `// vite.config.ts
import { palamedes } from "@palamedes/vite-plugin"
import solid from "@solidjs/vite-plugin"
export default defineConfig({ plugins: [palamedes({ framework: "solid" }), solid({ extensions: [".mdx"] })] })

// index.html
<html lang="de"></html>`,
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
      title: "See it render",
      body: "The adapter derives and loads the active locale's compiled fragment before translated code runs — the page now renders “Willkommen bei Palamedes”.",
      aside:
        "No app-owned catalog map, locale import, or runtime loader is required in the standard flow.",
      code: `$ pnpm dev`,
    },
  ],
  next: [
    {
      title: "Install",
      body: "Core, runtime, React adapter, and the Next plugin — plus the CLI as a dev dependency.",
      code: `pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/next-plugin server-only
pnpm add -D @palamedes/cli @palamedes/config`,
    },
    PACKAGE_BOUNDARY_STEP,
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
      body: "The Next plugin handles macro transform and .po loading; one server-only scope binds request-local i18n for the App Router render.",
      code: `// next.config.mjs
import { withPalamedes } from "@palamedes/next-plugin"
export default withPalamedes({})

// src/lib/load-i18n.server.ts
import "server-only"
import { cache } from "react"
import { createNextServerI18n } from "@palamedes/next-plugin/server"

export const createActiveServerI18n = cache(() => createNextServerI18n({ locale: "de" }))`,
    },
    {
      title: "Write & extract",
      body: "Author the message in a Server Component and run it inside the request-local server scope, then extract catalogs.",
      code: `// src/app/page.tsx
import { t } from "@palamedes/core/macro"
import { createActiveServerI18n } from "../lib/load-i18n.server"

function translateWelcome() {
  return t\`Welcome to Palamedes\`
}

export default async function Page() {
  await createActiveServerI18n()
  return <h1>{translateWelcome()}</h1>
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
      body: "The adapter loads only the active server locale and shares its immutable catalog across requests. Run Next.js to render the translation.",
      code: `$ pnpm dev`,
    },
  ],
};

export const PIPELINE = ["write", "extract", "translate", "render"];
