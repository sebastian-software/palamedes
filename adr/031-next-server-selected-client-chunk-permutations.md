# ADR-031: Next Server-Selected Client Chunk Permutations

**Status:** Proposed

**Last updated:** 2026-11-04

With `experimentalClientCatalogPermutations`, one Next production build writes
a copy of every translated client chunk per locale, with that locale's
messages inlined, and the server makes Next reference the request locale's
copies in everything it emits.

## Decision

`withPalamedes(config, { experimentalClientCatalogPermutations: true })` opts a
Next application into server-selected chunk permutations for `next build`
under Turbopack. It is a second experimental delivery next to
[ADR-030](./030-next-client-catalogs-outside-the-bundler-graph.md)'s message
assets; the two options are mutually exclusive, and the default and `next dev`
keep the in-graph fragments.

- **Marker literal, synchronous.** The transform loader leaves the same
  `"pmds-next:<key>:<payload>"` literal as asset mode in each translated
  client module, but passes it to a synchronous `clientCatalogMessages()`
  from `@palamedes/next-plugin/client-catalog-messages` with static imports
  and no top-level `await`. The post-compile step replaces the literal; a
  module that still receives the string was loaded from a locale-neutral chunk
  and throws with the module path.
- **Permutations after compile.** `compiler.runAfterProductionCompile` scans
  `.next/static/chunks` for markers, compiles each catalog once per locale,
  and writes `<chunk>.<locale>-<hash8>.js` next to each affected chunk, with
  the marker replaced by the locale's compiled messages as one expression and
  the stale `sourceMappingURL` removed. A chunk whose `"static/chunks/…"`
  literal names an affected chunk is affected too: its copies carry the
  rewritten literal, so lazy imports load the locale's copy without a runtime
  hook. Leaves are hashed before importers; a cycle among affected chunks
  fails the build. The neutral chunks stay on disk; a supported request never
  references them.
- **Locale tables inside the manifests.** The step appends an adapter to
  every `server/app/**/*_client-reference-manifest.js`. It keeps Next's own
  JavaScript, walks the evaluated `__RSC_MANIFEST` object, and replaces every
  array that names an affected chunk with a non-enumerable getter over one
  frozen table per locale. It parses no fields and preserves prefixes and
  `?dpl=` queries. Next traces its manifests into standalone and adapter
  output, so the tables ship without a trace edit; the duplication per route
  stays on the server. The adapter exposes one bind function on the
  manifest's VM global. An unbound getter throws; Next's `deepFreeze()` pass
  never reads it because it enumerates properties.
- **Binding in every rendering process.** `bindClientCatalogPermutations()`
  from `@palamedes/next-plugin/server` evaluates each manifest through Next's
  cached `evalManifest()` and binds the resolver. The app calls it from
  `register()` in `instrumentation.ts`, which runs before the first render in
  `next start`, standalone `server.js`, and hosted adapters. The build's
  prerender workers do not run that hook, so `withPalamedes()` appends a Node
  preload to `NODE_OPTIONS` while the build evaluates the config; the workers
  inherit it and start after the post-compile step wrote the manifests.
- **Locale source.** The resolver reads the first root route param whose
  value is a configured locale, then the `x-palamedes-locale` request header,
  and memoizes the result per render in a `WeakMap` keyed by Next's render
  store, because segment prefetch files and ISR output are serialized after
  the request store is gone. An app whose tree has no root locale segment
  resolves the locale in `proxy.ts` and passes it with `setRequestLocale()`
  from `@palamedes/next-plugin/proxy`, which overwrites any incoming value.
  A render without a locale, or with one the build did not compile, fails.
- **Rejected at build time.** A webpack build, translated code reachable from
  `build-manifest.json` (the bootstrap scripts, including
  `instrumentation-client`), a cyclic affected chunk graph, and an affected
  chunk that no manifest, importer, or `react-loadable-manifest.json` entry
  names fail with a Palamedes error. Affected JavaScript entries leave
  `react-loadable-manifest.json`; CSS entries stay.
- **Documented, not solved.** Per-variant source maps, Subresource Integrity
  for the copies, the Edge runtime, `experimental.workerThreads`, and the
  unknown-locale fallback segments of Cache Components are unsupported. A
  locale switch is a document navigation ([ADR-007](./007-locale-is-fixed-for-a-browser-document.md)):
  module IDs are the same in every copy, so a soft navigation keeps the loaded
  locale's modules.

## Context

Asset mode delivers the right messages with two extra asynchronous hops before
translated client code runs: the catalog map and the chunk's asset. The owner
wanted one build for 10 to 25 locales where the browser loads exactly one
locale's code and nothing from the others, and rejected one build per locale
and inlining every locale into every chunk.

Two throwaway experiments on Next 16.4.1 converged on the design above. They
showed that layouts run too late for entry scripts, because Next collects
layer assets before it invokes a layout; that `instrumentation.register()`
does not reach the build's prerender workers while a Node preload does; that
reading only the request store leaves neutral URLs in `*.segment.rsc` files
until the result is memoized per render; and that a translation-only catalog
edit renames one locale's affected copies and their importers while every
other file keeps its name.

The mode depends on these Next internals. Each is version-verified against
`16.4.1`, and the build or the first render fails when one changes:

| Internal                                                                                                          | Use                                                                            | If it changes                                                                 |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `next/dist/server/load-manifest.external.js`, `evalManifest(path)`                                                | Returns the cached, frozen VM context of a manifest by absolute path.          | Binding finds no bind function; the first render read throws.                 |
| `server/app/**/*_client-reference-manifest.js` assigning `globalThis.__RSC_MANIFEST[route]`                       | Chunk arrays with `static/chunks/<name>.js` entries become locale getters.     | No array matches; the build fails because affected chunks are uncovered.      |
| `react-loadable-manifest.json` entries `{ files: string[] }`                                                      | Affected JavaScript hints are removed.                                         | The build fails on the unexpected shape.                                      |
| `build-manifest.json`                                                                                             | Rejects translated bootstrap chunks.                                           | A translated bootstrap chunk could pass; the neutral chunk then throws.       |
| Turbopack browser chunks naming lazy chunks as `"static/chunks/<name>.js"` literals                               | Importer copies get rewritten literals.                                        | A lazy neutral chunk loads and its marker throws in the browser.              |
| `work-async-storage.external.js` and `work-unit-async-storage.external.js` (`rootParams`, `headers`)              | Locale source and per-render memo.                                             | The resolver finds no locale and the render fails.                            |
| Prerender workers as child processes that inherit `NODE_OPTIONS` after the config was evaluated                   | The preload binds the manifests in each worker.                                | Prerendering fails on the first unbound read.                                 |
| `instrumentation.register()` before the first render; `evalManifest` paths of `<projectDir>/<distDir>/server/app` | Runtime binding and its directory, `process.cwd()` plus the inlined `distDir`. | The bind call finds no manifests and throws, or the first render read throws. |

## Alternatives Considered

### Hook the Turbopack runtime's chunk loader

Rejected. Rewriting the `"static/chunks/…"` literals in importer copies
covers lazy imports with a build-time step instead of a runtime patch of
`__turbopack_context__`.

### A separate generated server file with the locale tables

Rejected for now. Next traces its own manifests; a separate file needs a trace
edit or a packaging step for standalone and adapters, which
[#1492](https://github.com/sebastian-software/palamedes/pull/1492) just
removed for asset mode. The tables repeat per route manifest but never reach
the browser.

### Parse and rewrite the manifest JSON

Rejected. It depends on field names and breaks the `${process.env.NEXT_DEPLOYMENT_ID}`
template literals Next writes with a `deploymentId`. The appended adapter
walks the evaluated object instead.

### Patch `evalManifest` or `vm` to bind without knowing the paths

Rejected. Both are global monkeypatches of Node or Next modules; evaluating
the known manifest paths through Next's own cache is explicit and reversible.

### One build per locale, or every locale inline

Both rejected by the owner: builds and deploys multiply by the locale count,
or every chunk carries every locale.

## Consequences

- Translated client code runs as soon as its chunk evaluates; no catalog map
  or asset request precedes it, and the browser never downloads another
  locale's messages.
- `.next/static/chunks` grows by one copy per affected chunk and locale. The
  copies are content-hashed and only a locale's own copies change when that
  locale's catalog changes.
- Every server process has to bind before its first render, including build
  workers and hosted adapters; forgetting it is a loud failure, not a silent
  fallback to neutral chunks.
- The locale must be known before the layout runs: from a root route param or
  from the Proxy.
- Deploy chunk copies, manifests, and prerendered artifacts of one build
  together; an old document with new chunk names, or the reverse, fails the
  same way as any Next build mismatch.

## Validation And Review Triggers

`examples/nextjs-route` builds the mode with `build:catalog-permutations`, and
`scripts/check-next-client-catalog-permutations.mjs` checks the contract
against a relocated standalone server: content-hashed copies without markers
or map pointers, prerendered documents, Flight payloads, and segment files
that name only their locale's copies, documents and Flight responses for four
locales and two routes, lazy chunk copies behind them, 24 concurrent
mixed-locale requests, and a Chromium session that hydrates German client
text, updates a plural on click, loads the lazy chunk, and requests no neutral
or foreign-locale chunk.

Make the mode Accepted, or fold it into ADR-030's defaults, once the contract
check runs in CI for the pinned Next and the canary workflow, the hosted demo
serves the copies through the CDN, and one production application has run it
on a hosted adapter. Revisit when Next offers a public per-request asset
selection or a chunk-level hook, or when a canary failure turns out to be an
intended Next change.
