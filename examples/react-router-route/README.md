# React Router Route Example

This example verifies Palamedes with React Router framework mode, SSR, route
actions, `.po` imports through `@palamedes/vite-plugin`, and a route-derived
locale.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm --filter @palamedes/example-react-router-route dev
pnpm --filter @palamedes/example-react-router-route build
pnpm --filter @palamedes/example-react-router-route extract
```

The dev server runs on `http://localhost:4041`. The production start script
also binds `PORT=4041`.

## Palamedes Files

- `palamedes.yaml` declares `en`, `de`, and `es` catalogs.
- `app/po.d.ts` declares `.po` imports for TypeScript.
- `app/lib/i18n.ts` wires the runtime and route locale controls.

The canonical overview for all 24 examples is
[`examples/README.md`](../README.md).
