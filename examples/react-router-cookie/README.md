# React Router Cookie Example

This example verifies Palamedes with React Router framework mode, SSR, route
actions, adapter-owned compiled catalog delivery through `@palamedes/react-router`
and `@palamedes/vite-plugin`, and a cookie-derived locale.

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

- `palamedes.yaml` declares `en`, `de`, `es`, and `fr` catalogs.
- `app/lib/i18n.ts` defines the cookie locale controls and resolves the request
  locale.
- `app/lib/i18n.server.ts` creates the adapter with `createReactRouterI18n` from
  `@palamedes/react-router`; the application only selects a locale and does not
  own manifest or HTML plumbing.
- `app/root.tsx` registers `i18n.middleware` on the root route.
- `app/entry.server.tsx` exports `i18n.handleRequest`.

The canonical overview for all 25 matrix examples is
[`examples/README.md`](../README.md).
