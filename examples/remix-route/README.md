# Remix v3 Route Example

This example pins stable `remix@3.0.0` and proves server and browser support
with the route locale strategy. It uses Remix's Node loader and asset server,
executable active-locale catalog fragments, rich messages, an interactive
server-rendered island, lazy loading, and request-scoped Frames.

```sh
pnpm --filter @palamedes/example-remix-route build
pnpm --filter @palamedes/example-remix-route start
```

Open <http://127.0.0.1:4061/de>. Locale switches navigate to a fresh document so SSR,
`html lang`, and the browser catalog agree. Browser code never imports PO files.

```sh
pnpm verify:examples:browser -- --id remix-route
```

The browser contract covers supported locales, interaction, locale switches,
reloads, document and standalone Frames, and catalog failure recovery under CSP.
[Open the live HTTPS demo](https://remix-route.examples.palamedes.dev/en); see [deployment evidence](../../docs/demo-deployments.md).
