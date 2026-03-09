# Palamedes Examples

Examples using the new OXC-based Lingui packages (codename: Palamedes).

## Examples

### `vite-react/`

Vite + React 19 example with hot module replacement.

```bash
cd examples-pala/vite-react
yarn install
yarn dev
```

### `nextjs-app/`

Next.js 15 App Router example.

```bash
cd examples-pala/nextjs-app
yarn install
yarn dev
```

## Packages Used

- `@lingui/oxc-transform` - Core macro transformer
- `@lingui/vite-plugin-oxc` - Vite plugin
- `@lingui/next-lingui-oxc` - Next.js integration

## Features Demonstrated

- `t`...`` tagged template macros
- `<Trans>` component
- `plural()` for pluralization
- Language switching at runtime
- `.po` file loading (no compile step needed)
