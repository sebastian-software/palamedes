# React Router Subdomain Example

This example verifies Palamedes with React Router framework mode, SSR, route
actions, `.po` imports through `@palamedes/vite-plugin`, and a subdomain-derived
locale.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm --filter @palamedes/example-react-router-subdomain dev
pnpm --filter @palamedes/example-react-router-subdomain build
pnpm --filter @palamedes/example-react-router-subdomain extract
```

The dev server runs on `http://localhost:4042`. The production start script
also binds `PORT=4042`. Local verification uses `*.lvh.me` hosts so the
leftmost subdomain label can select the locale without editing DNS.

## Palamedes Files

- `palamedes.yaml` declares `en`, `de`, and `es` catalogs.
- `app/po.d.ts` declares `.po` imports for TypeScript.
- `app/lib/i18n.ts` wires the runtime and subdomain locale controls.

The canonical overview for all twenty examples is
[`examples/README.md`](../README.md).
