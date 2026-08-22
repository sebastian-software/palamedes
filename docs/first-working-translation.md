# First Working Translation In 5 Minutes

This guide is the shortest path to the good Palamedes feeling: write a message,
extract it, translate it, and see it render without changing the mental model.

- one translated component
- one extraction run
- one `.po` import
- one active runtime instance

It uses Vite plus React because that is the smallest copy-paste setup today.
The same Vite plugin, runtime model, and `.po` flow now also work with Solid
through `@palamedes/solid` and `vite-plugin-solid`.

Before installing the native CLI, check [Platform support](./platform-support.md).
The first-run path requires a Node process on one of its published targets.

The steps assume an existing Vite app (with an `index.html`, an entry module,
and a `dev` script). If you are starting from an empty directory, scaffold one
first:

```bash
pnpm create vite@latest . --template react-ts
pnpm install
```

## 1. Install the packages

```bash
pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/vite-plugin react react-dom
pnpm add -D @palamedes/cli @vitejs/plugin-react vite typescript
```

(`react` and `react-dom` are already present in a scaffolded React app; the
line above just makes the full dependency set explicit.)

For Solid, swap the host package pair:

```bash
pnpm add @palamedes/core @palamedes/solid @palamedes/runtime @palamedes/vite-plugin solid-js
pnpm add -D @palamedes/cli vite-plugin-solid vite typescript
```

## 2. Add `palamedes.yaml`

```yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

## 3. Wire the Vite plugin

```ts
// vite.config.ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes(), react()],
})
```

## 4. Register the runtime

```ts
// src/i18n.ts
import { createI18n } from "@palamedes/core/compiled"
import { setClientI18n } from "@palamedes/runtime"

const i18n = createI18n()
setClientI18n(i18n)

export { i18n }
```

This guide uses the parser-free `/compiled` entrypoint because the Vite loader
turns generated `.po` catalogs into compiled messages. Use the package root only
when you intentionally load runtime ICU strings; see the
[`@palamedes/core` API reference](./api/core.md#exports).

## 5. Add one translated component

```tsx
// src/App.tsx
import { t } from "@palamedes/core/macro"

export function App() {
  return <h1>{t`Welcome to Palamedes`}</h1>
}
```

## 6. Extract catalogs

```bash
pnpm exec pmds extract
```

You should now have:

- `src/locales/en.po`
- `src/locales/de.po`

## 7. Add one translation

Open `src/locales/de.po` and change the translated string:

```po
msgid "Welcome to Palamedes"
msgstr "Willkommen bei Palamedes"
```

## 8. Load `.po` messages

TypeScript needs an ambient declaration for `.po` imports. Add it once:

```ts
// src/po.d.ts
declare module "*.po" {
  import type { CompiledCatalogMessages } from "@palamedes/core/compiled"

  export const messages: CompiledCatalogMessages
}
```

```tsx
// src/main.tsx
import React from "react"
import ReactDOM from "react-dom/client"
import { i18n } from "./i18n"
import { App } from "./App"
import { messages as enMessages } from "./locales/en.po"
import { messages as deMessages } from "./locales/de.po"

i18n.load("en", enMessages)
i18n.load("de", deMessages)
i18n.activate("de")

ReactDOM.createRoot(document.getElementById("root")!).render(<App />)
```

## Expected Result

After `pnpm dev`, the page should render:

```txt
Willkommen bei Palamedes
```

That proves the full local loop is working:

- macros transform correctly
- extraction works
- catalogs update correctly
- `.po` imports compile
- the runtime model is wired

From there, the same catalog flow can grow into CI audits, richer ICU
diagnostics, and framework-specific app wiring without changing how messages
are identified.

## What To Read Next

- [Configuration reference](./configuration.md) for catalog layout, fallbacks, and pseudo locales
- [CLI reference](./cli.md) for CI checks, catalog operations, and diagnostics
- [Locale strategies](./locale-strategies.md) for cookie, route, subdomain, and tld application wiring
- [Migration from Lingui](./migrate-from-lingui.md) for an adoption path from an existing catalog workflow
- [Examples](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md) for verified framework integrations
- [Proof, benchmarks, and current maturity](./proof-and-benchmarks.md) when you are evaluating the project
