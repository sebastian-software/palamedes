# React Router TLD Example

This example verifies Palamedes with React Router framework mode, SSR, route
actions, adapter-owned compiled catalog delivery through `@palamedes/react-router`
and `@palamedes/vite-plugin`, and a top-level-domain locale.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm --filter @palamedes/example-react-router-tld dev
pnpm --filter @palamedes/example-react-router-tld build
pnpm --filter @palamedes/example-react-router-tld extract
```

The dev server runs on `http://localhost:4043`. The production start script
also binds `PORT=4043`. Local browser verification maps
`palamedes-i18n.{com,de,es,fr}` to the dev server so the TLD can select the
locale without public DNS.

## Palamedes Files

- `palamedes.yaml` declares `en`, `de`, `es`, and `fr` catalogs.
- `app/lib/i18n.ts` defines the TLD locale controls and resolves the request
  locale.
- `app/lib/i18n.server.ts` creates the adapter with `createReactRouterI18n` from
  `@palamedes/react-router`; the application only selects a locale and does not
  own manifest or HTML plumbing.
- `app/root.tsx` registers `i18n.middleware` on the root route.
- `app/entry.server.tsx` exports `i18n.handleRequest`.

The canonical overview for all 25 matrix examples is
[`examples/README.md`](../README.md).
