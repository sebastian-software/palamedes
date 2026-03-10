# Palamedes

Next-generation i18n tooling powered by [OXC](https://oxc-project.github.io/) — fast macro transforms, message extraction, and framework adapters for Vite & Next.js.

## Packages

| Package | Description |
|---------|-------------|
| [`@palamedes/transform`](packages/transform) | OXC-based macro transformer — compiles i18n macros to runtime calls without Babel |
| [`@palamedes/extractor`](packages/extractor) | High-performance message extractor using oxc-parser |
| [`@palamedes/vite-plugin`](packages/vite-plugin) | Vite plugin for automatic macro transformation |
| [`@palamedes/next-plugin`](packages/next-plugin) | Next.js integration with webpack loaders |
| [`@palamedes/cli`](packages/cli) | CLI tool for message extraction with watch mode |

## Architecture

```
┌─────────────────────────────────────────┐
│  Framework Adapters                     │
│  @palamedes/vite-plugin, @palamedes/next-plugin│
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
pnpm add @palamedes/vite-plugin @palamedes/cli
```

```ts
// vite.config.ts
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes()],
})
```

### Next.js

```bash
pnpm add @palamedes/next-plugin @palamedes/cli
```

```ts
// next.config.ts
import { withPalamedes } from "@palamedes/next-plugin"

export default withPalamedes(nextConfig)
```

### Extracting Messages

```bash
pnpm exec pmds extract
pnpm exec pmds extract --watch
```

## Examples

- [`examples/vite-react`](examples/vite-react) — Vite + React SPA
- [`examples/nextjs-app`](examples/nextjs-app) — Next.js App Router with RSC

## Development

```bash
pnpm install
pnpm build
pnpm build:examples
pnpm test
```

Requires Node.js >= 20.

## License

[MIT](LICENSE) — Sebastian Software GmbH
