# pmds (Palamedes)

Next-generation Lingui CLI with OXC-based extraction.

## Installation

```bash
npm install -g pmds
# or
yarn global add pmds
```

## Usage

### Extract messages

```bash
# Extract messages from source files
pmds extract

# Watch mode
pmds extract --watch

# Remove obsolete messages
pmds extract --clean

# Custom config path
pmds extract --config ./lingui.config.ts

# Verbose output
pmds extract --verbose
```

## Features

- ⚡ **Fast**: Uses OXC parser (~20-100x faster than Babel)
- 📦 **Simple**: No compile step needed (use .po loader instead)
- 👀 **Watch mode**: Re-extract on file changes
- 🧹 **Clean mode**: Remove obsolete messages

## Configuration

Uses standard `lingui.config.ts`:

```typescript
import type { LinguiConfig } from "@lingui/conf"

const config: LinguiConfig = {
  locales: ["en", "de", "es"],
  sourceLocale: "en",
  catalogs: [
    {
      path: "<rootDir>/src/locales/{locale}",
      include: ["src/**/*.{ts,tsx}"],
    },
  ],
}

export default config
```

## Why "pmds"?

Short for **Palamedes** - the next generation of Lingui tooling.
