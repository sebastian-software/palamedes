# @palamedes/vite-plugin

Vite plugin for Lingui that uses OXC-based macro transformation. No Babel required.

## Features

- 🚀 **Fast**: Uses [oxc-parser](https://oxc-project.github.io/) for high-performance parsing
- 🔧 **No Babel**: Transforms Lingui macros without Babel or SWC plugins
- 📦 **PO Loader**: Compiles `.po` files to JS at build time
- ⚡ **Vite Native**: Works seamlessly with Vite's plugin system

## Installation

```bash
pnpm add @palamedes/vite-plugin @lingui/core @lingui/react
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [
    palamedes(),
    react(), // or any other framework plugin
  ],
})
```

That's it! The plugin will:

1. Transform Lingui macros (`` t`...` ``, `<Trans>`, etc.) to runtime calls
2. Compile `.po` files when imported

## Options

```ts
palamedes({
  // Only transform files matching this pattern (optional)
  include: /\.(tsx?|jsx?)$/,

  // Exclude files matching this pattern (optional)
  exclude: /node_modules/,

  // Enable/disable .po file compilation (default: true)
  enablePoLoader: true,

  // Path to lingui.config.js (optional)
  configPath: "./lingui.config.js",

  // Fail build on missing translations (default: false)
  failOnMissing: false,

  // Fail build on compilation errors (default: false)
  failOnCompileError: false,
})
```

## How It Works

### Macro Transformation

The plugin runs as a `pre` transform, processing your source files before other plugins (like React):

```tsx
// Before (your code)
import { t } from "@lingui/macro"
const greeting = t`Hello, ${name}!`

// After (transformed)
import { getI18n } from "@palamedes/runtime"
const greeting = getI18n()._({ id: "abc123", message: "Hello, {name}!", values: { name } })
```

### PO File Loading

Import `.po` files directly:

```tsx
import { getI18n } from "@palamedes/runtime"
import messages from "./locales/en.po"

const i18n = getI18n()
i18n.load("en", messages)
i18n.activate("en")
```

## Comparison with @lingui/vite-plugin

| Feature | @lingui/vite-plugin | @palamedes/vite-plugin |
|---------|---------------------|-------------------------|
| PO compilation | ✅ | ✅ |
| Macro transformation | ❌ (requires babel) | ✅ |
| Babel required | Yes | No |
| Parser | N/A | OXC |

## License

MIT
