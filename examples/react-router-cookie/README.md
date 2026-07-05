# React Router Cookie Example

This example verifies Palamedes with React Router framework mode, SSR, route
actions, `.po` imports through `@palamedes/vite-plugin`, and a cookie-derived
locale.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm --filter @palamedes/example-react-router-cookie dev
pnpm --filter @palamedes/example-react-router-cookie build
pnpm --filter @palamedes/example-react-router-cookie extract
```

The dev server runs on `http://localhost:4040`. The production start script
also binds `PORT=4040`.

## Palamedes Files

- `palamedes.yaml` declares `en`, `de`, and `es` catalogs.
- `app/po.d.ts` declares `.po` imports for TypeScript.
- `app/lib/i18n.ts` wires the runtime and locale controls.

The canonical overview for all twenty examples is
[`examples/README.md`](../README.md).
