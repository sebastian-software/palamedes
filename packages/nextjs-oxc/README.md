# @lingui/next-lingui-oxc

Next.js integration for Lingui using OXC-based macro transformation. No Babel required.

## Features

- 🚀 **Fast**: Uses [oxc-parser](https://oxc-project.github.io/) for high-performance parsing
- 🔧 **No Babel**: Transforms Lingui macros without Babel or SWC plugins
- 📦 **PO Loader**: Compiles `.po` files to JS at build time
- ⚡ **Webpack & Turbopack**: Works with both bundlers

## Installation

```bash
npm install @lingui/next-lingui-oxc @lingui/core @lingui/react
# or
yarn add @lingui/next-lingui-oxc @lingui/core @lingui/react
# or
pnpm add @lingui/next-lingui-oxc @lingui/core @lingui/react
```

## Usage

```js
// next.config.js
const { withLinguiOxc } = require("@lingui/next-lingui-oxc")

/** @type {import('next').NextConfig} */
const nextConfig = {
  // your existing config
}

module.exports = withLinguiOxc(nextConfig)
```

That's it! The plugin will:

1. Transform Lingui macros (`` t`...` ``, `<Trans>`, etc.) to runtime calls
2. Compile `.po` files when imported

## Options

```js
const { withLinguiOxc } = require("@lingui/next-lingui-oxc")

module.exports = withLinguiOxc(nextConfig, {
  // Only transform files matching this pattern (optional)
  include: /\.(tsx?|jsx?)$/,

  // Exclude files matching this pattern (optional)
  exclude: /node_modules/,

  // Enable/disable .po file compilation (default: true)
  enablePoLoader: true,

  // Path to lingui.config.js (optional)
  configPath: "./lingui.config.js",

  // Module to import getI18n from (default: "@palamedes/runtime")
  runtimeModule: "@palamedes/runtime",
})
```

## How It Works

### With Webpack

The plugin adds webpack loaders that:
1. Transform Lingui macros in JS/TS files before SWC processes them
2. Compile `.po` files to JS modules

### With Turbopack

The plugin configures Turbopack rules to:
1. Run the OXC transform loader for JS/TS files
2. Compile `.po` files to JS modules

## Usage in Components

```tsx
// Using macros (transformed at build time)
import { t } from "@lingui/macro"
import { Trans } from "@lingui/react/macro"

function Greeting({ name }) {
  return (
    <div>
      <p>{t`Hello, ${name}!`}</p>
      <Trans>Welcome to our app</Trans>
    </div>
  )
}
```

```tsx
// Importing .po files
import { getI18n } from "@palamedes/runtime"
import messages from "./locales/en.po"

const i18n = getI18n()
i18n.load("en", messages)
i18n.activate("en")
```

## Comparison with @lingui/swc-plugin

| Feature | @lingui/swc-plugin | @lingui/next-lingui-oxc |
|---------|-------------------|-------------------------|
| PO compilation | ❌ (separate loader) | ✅ Built-in |
| Macro transformation | ✅ | ✅ |
| Written in | Rust | TypeScript |
| Parser | SWC | OXC |
| Easy to extend | Difficult | Easy |

## License

MIT
