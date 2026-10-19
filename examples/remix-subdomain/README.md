# Remix v3 Subdomain Example

This example pins stable `remix@3.0.0` and proves server and browser support
with the subdomain locale strategy. It uses Remix's Node loader and asset server,
executable active-locale catalog fragments, rich messages, an interactive
server-rendered island, lazy loading, and request-scoped Frames.

```sh
pnpm --filter @palamedes/example-remix-subdomain build
pnpm --filter @palamedes/example-remix-subdomain start
```

Open <http://en.lvh.me:4062/>. Locale switches navigate to a fresh document so SSR,
`html lang`, and the browser catalog agree. Browser code never imports PO files.

```sh
pnpm verify:examples:browser -- --id remix-subdomain
```

The browser contract covers supported locales, interaction, locale switches,
reloads, document and standalone Frames, and catalog failure recovery under CSP.
Public hosting remains pending; see [deployment verification](../../docs/demo-deployments.md).
