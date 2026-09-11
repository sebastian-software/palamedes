# First Working Translation In 5 Minutes

This guide is the shortest path to the good Palamedes feeling: write a message,
extract it, translate it, and see it render without changing the mental model.

- one translated component
- one extraction run
- one catalog configuration
- one automatically delivered active-locale runtime

It uses Vite plus React because that is the smallest copy-paste setup today.
The same Vite plugin, runtime model, and catalog flow now also work with Solid
through `@palamedes/solid`, `@solidjs/web`, and `@solidjs/vite-plugin`.

For a Next.js 16 App Router application, use the separate
[First Working Translation with Next.js](./nextjs-first-run.md) guide.

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
pnpm add @palamedes/core @palamedes/solid @palamedes/runtime @palamedes/vite-plugin @solidjs/web solid-js
pnpm add -D @palamedes/cli @solidjs/vite-plugin vite typescript
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
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { palamedes } from "@palamedes/vite-plugin";

export default defineConfig({
  plugins: [palamedes(), react()],
});
```

## 4. Let the adapter initialize the runtime

The standard Vite flow does not need an app-owned `i18n` module. Do not add
`createI18n`, `setClientI18n`, `.po.d.ts`, locale imports, or `i18n.load()`
calls. The plugin derives the translated module's catalog dependencies,
initializes the parser-free runtime, and awaits the active locale's compiled
fragment before the module runs.

For this static walkthrough, set the active locale in `index.html`:

```html
<html lang="de"></html>
```

A host with locale negotiation must write the selected `lang` before its module
entry runs. See the [`@palamedes/vite-plugin` API reference](./api/vite-plugin.md)
for the explicit custom-integration escape hatch; application-owned catalog
maps are not part of the standard flow.

## 5. Add one translated component

```tsx
// src/App.tsx
import { t } from "@palamedes/core/macro";

export function App() {
  return <h1>{t`Welcome to Palamedes`}</h1>;
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

## Expected Result

After `pnpm dev`, the page should render:

```txt
Willkommen bei Palamedes
```

That proves the full local loop is working:

- macros transform correctly
- extraction works
- catalogs update correctly
- the catalog is updated through extraction and the adapter derives its dependency
- the active locale's compiled fragment is loaded before translated code runs
- no app-owned catalog map or runtime loader is required

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
