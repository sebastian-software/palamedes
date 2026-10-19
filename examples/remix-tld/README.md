# Remix v3 Tld Example

This example pins stable `remix@3.0.0` and proves server and browser support
with the tld locale strategy. It uses Remix's Node loader and asset server,
executable active-locale catalog fragments, rich messages, an interactive
server-rendered island, lazy loading, and request-scoped Frames.

```sh
pnpm --filter @palamedes/example-remix-tld build
pnpm --filter @palamedes/example-remix-tld start
```

Open <http://remix.example.com:4063/>. Local TLD hostnames need local DNS or host mappings; the browser verifier maps its test domains automatically. Locale switches navigate to a fresh document so SSR,
`html lang`, and the browser catalog agree. Browser code never imports PO files.

```sh
pnpm verify:examples:browser -- --id remix-tld
```

The browser contract covers supported locales, interaction, locale switches,
reloads, document and standalone Frames, and catalog failure recovery under CSP.
Public hosting remains pending; see [deployment verification](../../docs/demo-deployments.md).
