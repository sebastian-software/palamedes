# Remix v3 TLD Example

This example proves the Remix v3 server integration with a top-level-domain
derived locale (`.de` -> `de`, `.com` -> `en`).

Run it locally:

```sh
pnpm --filter @palamedes/example-remix-tld build
pnpm --filter @palamedes/example-remix-tld start
```

Then open <http://remix.example.de:4063/> with a matching local host mapping or
use the smoke verifier, which sends the `Host` header directly.
