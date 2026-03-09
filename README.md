# Palamedes

Next-generation i18n tooling powered by [OXC](https://oxc-project.github.io/) — fast macro transforms, message extraction, and framework adapters for Vite & Next.js.

## Packages

| Package | Description |
|---------|-------------|
| [`@palamedes/transform`](packages/oxc-transform) | OXC-based macro transformer — compiles i18n macros to runtime calls without Babel |
| [`@palamedes/extractor`](packages/extractor-oxc) | High-performance message extractor using oxc-parser |
| [`@palamedes/vite`](packages/vite-plugin-oxc) | Vite plugin for automatic macro transformation |
| [`@palamedes/next`](packages/next-lingui-oxc) | Next.js integration with webpack loaders |
| [`@palamedes/cli`](packages/cli) | CLI tool for message extraction with watch mode |

## Architecture

```
┌─────────────────────────────────────────┐
│  Framework Adapters                     │
│  @palamedes/vite, @palamedes/next       │
├─────────────────────────────────────────┤
│  Core Transform                         │
│  @palamedes/transform                   │
├─────────────────────────────────────────┤
│  OXC Parser + magic-string              │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│  @palamedes/cli                         │
├─────────────────────────────────────────┤
│  @palamedes/extractor                   │
├─────────────────────────────────────────┤
│  OXC Parser + pofile-ts                 │
└─────────────────────────────────────────┘
```

## Getting Started

### Vite

```bash
npm install @palamedes/vite @palamedes/cli
```

```ts
// vite.config.ts
import { lingui } from "@palamedes/vite"

export default defineConfig({
  plugins: [lingui()],
})
```

### Next.js

```bash
npm install @palamedes/next @palamedes/cli
```

```ts
// next.config.ts
import { withLingui } from "@palamedes/next"

export default withLingui(nextConfig)
```

### Extracting Messages

```bash
npx pmds extract
npx pmds extract --watch
```

## Examples

- [`examples/vite-react`](examples/vite-react) — Vite + React SPA
- [`examples/nextjs-app`](examples/nextjs-app) — Next.js App Router with RSC

## Development

```bash
yarn install
yarn build
yarn test
```

Requires Node.js >= 20.

## License

[MIT](LICENSE) — Sebastian Software GmbH
