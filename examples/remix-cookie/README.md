# Remix v3 Cookie Example

This example pins stable `remix@3.0.0` and proves server and browser support
with the cookie locale strategy. It uses Remix's Node loader and asset server,
executable active-locale catalog fragments, rich messages, an interactive
server-rendered island, lazy loading, and request-scoped Frames.

```sh
pnpm --filter @palamedes/example-remix-cookie build
pnpm --filter @palamedes/example-remix-cookie start
```

Open <http://127.0.0.1:4060/>. Locale switches navigate to a fresh document so SSR,
`html lang`, and the browser catalog agree. Browser code never imports PO files.

```sh
pnpm verify:examples:browser -- --id remix-cookie
```

The browser contract covers supported locales, interaction, locale switches,
reloads, document and standalone Frames, and catalog failure recovery under CSP.
[Open the live HTTPS demo](https://remix-cookie.examples.palamedes.dev); see [deployment evidence](../../docs/demo-deployments.md).
