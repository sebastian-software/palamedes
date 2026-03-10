# Palamedes Examples

Examples using the new OXC-based Lingui packages (codename: Palamedes).

## Examples

### `vite-react/`

Vite + React 19 example with hot module replacement.

```bash
cd examples-pala/vite-react
pnpm install
pnpm dev
```

### `nextjs-app/`

Next.js 15 App Router example.

```bash
cd examples-pala/nextjs-app
pnpm install
pnpm dev
```

## Packages Used

- `@palamedes/transform` - Core macro transformer
- `@palamedes/vite-plugin` - Vite plugin
- `@palamedes/next-plugin` - Next.js integration

## Features Demonstrated

- `t`...`` tagged template macros
- `<Trans>` component
- `plural()` for pluralization
- Language switching at runtime
- `.po` file loading (no compile step needed)
