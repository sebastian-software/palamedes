# React Router TLD Example

This example verifies Palamedes with React Router framework mode, SSR, route
actions, `.po` imports through `@palamedes/vite-plugin`, and a top-level-domain
locale.

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
- `app/po.d.ts` declares `.po` imports for TypeScript.
- `app/lib/i18n.ts` wires the runtime and tld locale controls.

The canonical overview for all 24 examples is
[`examples/README.md`](../README.md).
