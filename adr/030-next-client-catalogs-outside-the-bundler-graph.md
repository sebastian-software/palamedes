# ADR-030: Next Production Client Catalogs Outside the Bundler Graph

**Status:** Proposed

**Last updated:** 2026-11-04

With `experimentalClientCatalogAssets`, Next production builds deliver client
messages as static assets grouped per emitted chunk, outside the Turbopack or
webpack module graph.

## Decision

`withPalamedes(config, { experimentalClientCatalogAssets: true })` opts a Next
application into out-of-graph client catalog delivery for `next build`. The
default and `next dev` keep the in-graph fragments that
[the Next.js plugin reference](../docs/api/next-plugin.md) describes.

- **Marker literal.** The transform loader gives each translated client module
  the string literal `"pmds-next:<key>:<payload>"`. The key is the first 12 hex
  digits of the SHA-256 of the module's root-relative path; the payload is
  base64url JSON with the source path and the selected message IDs. The module
  passes the literal to `loadClientCatalog()` from
  `@palamedes/next-plugin/client-catalog`, which loads its asset with a native
  `import()` that the bundler ignores.
- **Grouping after compile.** `compiler.runAfterProductionCompile` scans
  `.next/static/chunks` for marker literals and applies the Vite grouping rule:
  one asset per chunk and locale, its own asset for a module in zero or several
  chunks, and separate assets when message IDs conflict. Assets are rendered by
  the native catalog renderer ([ADR-019](./019-native-catalog-rendering-produces-bundler-modules.md)),
  named by content hash, and written to `.next/static/palamedes/`.
- **One map per locale.** The same step writes one content-hashed catalog map
  module per locale next to the assets. It lists every translated client
  module of the locale as concatenated keys per asset, so soft navigations to
  other routes resolve without another lookup, and the browser caches it
  across pages. The server-side manifest `.next/palamedes-client-catalogs.json`
  maps each locale to its map URL. The step appends the manifest to every
  server route's `.nft.json` trace, because Turbopack resolves
  `outputFileTracingIncludes` before the manifest exists; standalone output
  and deployment adapters then ship it with each server function.
- **Map link in the document.** The root layout renders
  `<PalamedesClientCatalogs locale={locale} />` from
  `@palamedes/next-plugin/server` in `<head>`. It emits
  `<link id="palamedes-client-catalogs" rel="modulepreload">` to the locale's
  map, so the document carries only one URL and the map downloads alongside
  Next's chunks. The map covers the one document locale
  ([ADR-007](./007-locale-is-fixed-for-a-browser-document.md)); a locale switch
  is a full document navigation that renders a new map.
- **Failures fail closed.** A missing map link, a map for another locale than
  `<html lang>`, a module key without an asset, and an asset without `messages`
  throw at once: they are deterministic build or deployment faults. A server
  that cannot read the manifest throws an error naming the expected path. A
  failed map or asset `import()` is retried once under the same URL plus `?pmds-retry=1`,
  because browsers keep a failed module fetch in the module map for its URL.
  The final error names the module source and the URL and carries the
  import error as `cause`. The module's evaluation then fails like a failed
  in-graph fragment and reaches the application's `error.tsx` view.
- **Default later.** The flag stays experimental and this record Proposed
  until the criteria below hold. Making the flag the production default makes
  this record Accepted.

## Context

In-graph delivery imports one selected fragment per translated client module
and locale. That keeps messages next to the code that uses them, but the graph
grows with modules times locales: on a synthetic 700-component app with 10
locales, the client build emitted about 7,000 chunks and a route requested one
fragment per translated module. Vite avoids this by attaching messages to output
chunks in its chunk hooks. Turbopack has no chunk-level hook, so the grouping
has to read the emitted chunks after compilation. The
[measurements in #1485](https://github.com/sebastian-software/palamedes/pull/1485)
show build time falling by more than half, peak memory by about 40%, and one
message request per route chunk.

Reading the emitted chunks depends on one assumption that no Next API
promises: the bundler and minifier keep each marker string literal intact.
`scripts/check-next-client-catalog-assets.mjs` guards it. The check derives the
translated client modules from the macro transform, not from the build output,
and asserts that every marker survives in the chunks, that no in-graph fragment
remains, and that each locale's map lists every module with an asset that
exports messages. `scripts/check-next-client-catalog-standalone.mjs` then moves
the standalone output away from the project, starts `server.js` from another
working directory, and fetches every document, map, and asset. CI runs both
for Turbopack and webpack on every change against the pinned Next release,
and the scheduled `Next.js Canary` workflow runs it against `next@canary`,
opening a tracking issue when a canary breaks it.

### Content Security Policy

The map and the assets are module scripts fetched under `script-src`: the map
through a `modulepreload` link and a native `import()`, the assets through a
native `import()`. They are same-origin, or use the `assetPrefix` origin that
Next's own chunks already need. A dynamic import inherits the importing
script's nonce and is not parser-inserted, so it passes both a
`'self' 'nonce-…'` policy and a `'nonce-…' 'strict-dynamic'` policy. Both were
checked in the route example with a per-request nonce from middleware, with
the earlier inline map: the asset loaded and the client UI hydrated in the document locale. With
`require-trusted-types-for 'script'`, Next 16.4.1's own client runtime fails
before any Palamedes code runs, so that policy is outside this contract.

Module scripts always fetch in CORS mode, while Next's chunks are classic
scripts. An `assetPrefix` on another origin therefore needs
`Access-Control-Allow-Origin` on `/_next/static/palamedes/`; the build warns
about absolute prefixes.

## Alternatives Considered

### Keep in-graph fragments in production

Rejected as the only option, kept as the default. It is correct and needs no
post-compile step, but its build cost grows with modules times locales.

### One full catalog per locale

Rejected. It needs one request, but every route downloads every client message
of its locale.

### Record modules from loader side effects

Rejected. Turbopack's persistent build cache can skip loaders on later builds
and hide modules from such a list. The emitted chunks are the authority for
which module ships where.

### Render source-locale text when an asset fails

Rejected. The server HTML is already translated, so source text in the client
would not match during hydration and would leave a mixed-language document.
It would also hide a broken deployment from error reporting.

## Consequences

- Production client chunks no longer contain message modules. A route requests
  one asset per chunk that carries translated modules.
- Development and production deliver messages differently, so development
  memory does not improve and only production builds exercise the asset path.
- Assets are written into `.next/static` after compilation. A deployment has to
  ship them with the chunks of the same build.
- Each locale's map lists every translated client module. It costs about
  8 bytes gzip per module, once per locale and deployment, because the
  document only carries its URL.
- The server traces gain one file that Palamedes appends after compilation.
  Editing `.nft.json` is not a documented Next contract; the standalone check
  catches a change to where or when Next writes the traces.

## Validation And Review Triggers

Make the flag the production default once:

- the contract check passes for the pinned Next in CI and the canary workflow
  has stayed green across at least one Next minor release;
- a real Vercel deployment serves the late-written assets and finds the
  traced manifest, as the standalone check and an adapter probe show for
  self-hosting; and
- at least one production application has run with the flag.

`next build --webpack`, warm build caches, `basePath`, `assetPrefix`,
`output: "standalone"`, and the map component are already covered.

Revisit this record when Next offers a chunk-level hook or a documented chunk
manifest that makes the marker scan unnecessary, or when a canary failure turns
out to be an intended Next change.
