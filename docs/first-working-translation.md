# First Working Translation In 5 Minutes

This guide is the shortest path to a real Palamedes success case:

- one translated component
- one extraction run
- one `.po` import
- one active runtime instance

It uses Vite because that is the smallest setup today.

## 1. Install the packages

```bash
pnpm add @palamedes/vite-plugin @palamedes/runtime @lingui/core @lingui/react
pnpm add -D @palamedes/cli @palamedes/config @vitejs/plugin-react vite typescript
```

## 2. Add `palamedes.config.ts`

```ts
import { defineConfig } from "@palamedes/config"

export default defineConfig({
  locales: ["en", "de"],
  sourceLocale: "en",
  catalogs: [
    {
      path: "src/locales/{locale}",
      include: ["src"],
    },
  ],
})
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
import { i18n } from "@lingui/core"
import { setClientI18n } from "@palamedes/runtime"

setClientI18n(i18n)

export { i18n }
```

## 5. Add one translated component

```tsx
// src/App.tsx
import { t } from "@lingui/core/macro"

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

That proves the full path is working:

- macros transform correctly
- extraction works
- catalogs update correctly
- `.po` imports compile
- the runtime model is wired

## What To Read Next

- [Root README](https://github.com/sebastian-software/palamedes/blob/main/README.md)
- [Proof, benchmarks, and current maturity](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)
- [Migration from Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/migrate-from-lingui.md)
- [Examples](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)
