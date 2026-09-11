# Palamedes v2 implementation issues

**Status:** Published; implementation pending
**Parent:** [Epic #1204](https://github.com/sebastian-software/palamedes/issues/1204)
**Milestone:** [Palamedes v2](https://github.com/sebastian-software/palamedes/milestone/1)

These slices implement the accepted
[v2 plan](2026-09-11-compiled-runtime-and-catalog-delivery.md). Each includes
the behavior, integration, tests, and documentation necessary to demonstrate
its outcome. IDs A–K are navigation aids; GitHub issue numbers and native dependency links
are authoritative for execution. The accepted breakdown was published on
2026-09-11, including the related existing issues identified during backlog review.

AFK means the accepted product decisions are sufficient to implement the slice
without a scheduled design approval. It does not bypass repository review or
release checks. If a host cannot satisfy the contract, report the evidence and
revisit that constraint rather than silently downgrading behavior. All changes
target v2; merge/release sequencing must not publish breaking behavior as 1.x.

## Overview

| ID                                                                       | Slice                                                              | Type | Blocked by                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ | ---- | ----------------------------------------------- |
| [A / #1205](https://github.com/sebastian-software/palamedes/issues/1205) | Reject invalid ICU while compiling valid translation fallbacks     | AFK  | None                                            |
| [B / #1206](https://github.com/sebastian-software/palamedes/issues/1206) | Execute and render messages through one parser-free public runtime | AFK  | #1205                                           |
| [C / #1207](https://github.com/sebastian-software/palamedes/issues/1207) | Reuse lazy server catalogs with isolated lightweight requests      | AFK  | #1206                                           |
| [D / #1208](https://github.com/sebastian-software/palamedes/issues/1208) | Deliver Next messages transparently with usable error boundaries   | AFK  | #1206, #1207, #1144                             |
| [E / #1209](https://github.com/sebastian-software/palamedes/issues/1209) | Encapsulate Vite delivery through a complete React Router flow     | AFK  | #1206, #1207, #1144                             |
| [F / #1210](https://github.com/sebastian-software/palamedes/issues/1210) | Deliver TanStack Start messages through the v2 adapter contract    | AFK  | #1209                                           |
| [G / #1211](https://github.com/sebastian-software/palamedes/issues/1211) | Deliver Solid messages through the v2 adapter contract             | AFK  | #1209                                           |
| [H / #1212](https://github.com/sebastian-software/palamedes/issues/1212) | Deliver Waku messages through the v2 adapter contract              | AFK  | #1209                                           |
| [I / #1213](https://github.com/sebastian-software/palamedes/issues/1213) | Deliver React Router RSC messages through the v2 adapter contract  | AFK  | #1209                                           |
| [J / #1214](https://github.com/sebastian-software/palamedes/issues/1214) | Deliver compiled Remix messages through its asset pipeline         | AFK  | #1206, #1207, #1144                             |
| [K / #1215](https://github.com/sebastian-software/palamedes/issues/1215) | Complete v2 migration and release contract verification            | AFK  | #1208, #1210, #1211, #1212, #1213, #1214, #1139 |

## A — [#1205](https://github.com/sebastian-software/palamedes/issues/1205) Reject invalid ICU while compiling valid translation fallbacks

**Type:** AFK
**Labels:** `type:feature`, `stability`, `dx`, `priority:P2`

### What to build

An invalid source or translated ICU message must stop catalog compilation with
an actionable error. Valid messages missing a target-locale translation still
compile through the configured fallback chain unless `failOnMissing` requires
completeness. Apply the same semantics to complete catalogs and selected
fragments through the existing Next, Vite, and Remix compilation paths.

### Acceptance criteria

- [ ] Invalid syntax, unsupported formatter kinds/styles, and unlowerable ICU
      fail compilation in development and production; no lazy-parser output or
      default-style substitution makes compilation succeed.
- [ ] Diagnostics identify source message, locale, catalog, and the invalid
      construct. Structured audit/inspection APIs can still collect diagnostics
      without claiming to have produced a valid executable catalog.
- [ ] Missing translations produce compiled fallback messages with correct
      interpolation, plurals, and rich text; missing status remains observable.
- [ ] `failOnMissing` rejects a missing requested translation even when its
      fallback is valid. Invalid fallback messages fail regardless of this option.
- [ ] `failOnCompileError: false` no longer weakens this contract; removed or
      changed configuration has a clear v2 migration diagnostic and documentation.
- [ ] Representative full/selected and sync/async host builds verify the same
      behavior, including a changed catalog in development. State whether validation
      covers selected messages or the whole catalog; retain an explicit whole-catalog
      audit path without claiming unvisited assets were compiled.

### Blocked by

None — can start immediately on the v2 workstream.

## B — [#1206](https://github.com/sebastian-software/palamedes/issues/1206) Execute and render messages through one parser-free public runtime

**Type:** AFK
**Labels:** `type:feature`, `stability`, `packaging`, `priority:P2`

### What to build

Make supported application runtime entrypoints execute compiled messages on
server and client. A macro-authored message must render identically through
Core, React, Solid, and the existing Remix compiled renderer without a runtime
ICU parser. Unexpected missing compiled entries propagate an error instead of
substituting source text or an internal key.

### Acceptance criteria

- [ ] Package-root runtime imports and existing `compiled` imports use the same
      parser-free implementation. Compatible subpath aliases remain usable.
- [ ] Constants, values, Intl formatting, choices, and rich messages work in
      server and client renderers. Compiled source-locale fallbacks from #1205 behave
      like compiled translations.
- [ ] Runtime parser and parsed-node APIs are removed from the application
      runtime. Inventory replacements explicitly; only demonstrated tooling needs
      justify moving an API to a tooling entrypoint.
- [ ] A runtime catalog miss throws a diagnosable error. Source text, raw ICU,
      and internal IDs are never returned as replacement message output; telemetry
      hooks cannot convert that failure into successful rendering.
- [ ] Invalid render inputs and formatter execution errors have explicit error
      propagation, without reviving source-pattern fallback. Ordinary host error
      handling remains the integration surface.
- [ ] Migrate `keepSourceFallbacks` and related parser metadata. Source identity
      may remain in developer diagnostics; distinguish that from user output and
      from valid source-language messages compiled into catalogs.
- [ ] Published entrypoint/type checks and real renderer/bundle probes establish
      parser absence, including package roots and supported import formats.
- [ ] Include concrete migration examples for removed calls and options.

### Blocked by

#1205

## C — [#1207](https://github.com/sebastian-software/palamedes/issues/1207) Reuse lazy server catalogs with isolated lightweight requests

**Type:** AFK
**Labels:** `type:feature`, `performance`, `priority:P2`

### What to build

Provide adapter-owned loading of complete compiled catalogs on first demand for
a locale, reusing immutable catalog content within each process. Demonstrate
the path in a real Next SSR request: the application supplies locale policy,
and each request gets isolated state without manually importing catalogs or
rebuilding all message entries.

### Acceptance criteria

- [ ] A request for one locale does not eagerly evaluate other locale catalogs.
      Concurrent and subsequent requests reuse successful loads within the process.
- [ ] Request locale, time zone, and mutable state remain isolated across
      concurrent requests, awaits, failures, and streaming/render lifetimes.
- [ ] Complete catalog lookup content is shared; request creation does not
      allocate one wrapper per catalog message. Additive fragment loading and
      override order remain correct without mutating another request's view.
- [ ] Catalog/config edits invalidate the appropriate development generation;
      old in-flight requests are not corrupted by replacing shared content.
- [ ] Failures propagate before translated execution, with documented recovery
      behavior that respects module-loader caching.
- [ ] Record cold load, warmed lookup/request creation, and retained memory for
      representative and stress fixtures across locale counts and concurrent
      requests. Include multiple processes/workers and a mixed-locale sweep.
- [ ] Separate shared catalog growth from request-state growth; compare the
      existing per-message-wrapper baseline with the new path and establish a
      reproducible regression guard from the results.
- [ ] Document that ESM caching may retain every used locale for the process
      lifetime. No bounded-LRU claim, Redis dependency, or universal server module
      splitting requirement is introduced.

### Blocked by

#1206

## D — [#1208](https://github.com/sebastian-software/palamedes/issues/1208) Deliver Next messages transparently with usable error boundaries

**Type:** AFK
**Labels:** `type:feature`, `stability`, `dx`, `priority:P2`

### What to build

Make the v2 Next integration automatically load active-locale compiled message
fragments before their client modules are used. Remove application catalog
boundaries and production degradation. A failed fragment must produce a usable
host error view instead of broken translated content, on initial loading and
later navigation.

### Acceptance criteria

- [ ] Start with a minimal real-browser proof that fragment rejection reaches
      usable Next error handling under Turbopack and webpack, including rejection
      before a component mounts. Use the result to choose host wiring; do not assume
      top-level await rejection alone satisfies the contract.
- [ ] Macro-authored client components and helpers load only active-locale
      messages for evaluated modules; a lazy route adds its fragments on navigation.
- [ ] SSR and Server Functions use isolated state and adapter-owned catalog
      loading. Existing server fragment support may remain; no executable function
      crosses an RSC serialization boundary.
- [ ] Missing/rejected/invalid fragments and unexpected runtime catalog misses
      never render source substitutes, raw ICU, or internal IDs. Error UI remains
      usable without the failed catalog; recovery is tested for cached failures.
- [ ] Ordinary application error UI and locale selection suffice; no catalog
      loader, catalog-specific boundary, or opt-in splitting flag is required for
      the standard v2 setup.
- [ ] Migrate the cookie, route, subdomain, and TLD examples and guidance.
- [ ] Verify strict-CSP operation, development edits, initial hydration, route
      navigation, and document locale changes with production network assertions.

### Blocked by

#1206, #1207, #1144

## E — [#1209](https://github.com/sebastian-software/palamedes/issues/1209) Encapsulate Vite delivery through a complete React Router flow

**Type:** AFK
**Labels:** `type:feature`, `stability`, `dx`, `priority:P2`

### What to build

Turn the current Vite/React Router import-map example into an adapter-owned v2
integration. A normal macro-authored app gets active-locale module fragments,
correct SSR, and usable loading/error behavior without copying manifest readers,
HTML stream manipulation, or client catalog initialization into application code.

### Acceptance criteria

- [ ] Prove initial and lazy-navigation fragment failure reaches host error UI
      before selecting final dependency wiring. Cover import-map failures before
      component mounting, not only render-time exceptions.
- [ ] Vite owns generated assets and dependency metadata; a reusable host
      integration owns manifest loading, locale binding, HTML insertion before module
      execution, and preloads. Applications configure locale policy only.
- [ ] Production fetches active-locale fragments for evaluated modules. Verify
      shared helpers, lazy routes, MDX, and pseudo locales without parser inclusion.
- [ ] Development has the same locale and failure semantics and correct catalog
      invalidation. Any remaining development-only asset differences are documented
      and measured; they do not become a second public loading mode.
- [ ] SSR uses #1207's lazy shared catalogs; server builds never depend on a browser
      import map or emit inappropriate client message assets.
- [ ] Test non-root deployment bases, deterministic asset emission, catalog-only
      changes, CSP-compatible HTML integration, and error UI independent of failed
      fragments. Decide retry/reload behavior based on a real host proof.
- [ ] Migrate all standard React Router locale-strategy examples and the Vite
      MDX reference flow, including setup docs and options previously experimental.
- [ ] Provide the shared integration seams needed by the TanStack, Solid, Waku, and React Router RSC slices; do not create another
      catalog compiler or move message semantics into the host layer.

### Blocked by

#1206, #1207, #1144

## F — [#1210](https://github.com/sebastian-software/palamedes/issues/1210) Deliver TanStack Start messages through the v2 adapter contract

**Type:** AFK
**Labels:** `type:feature`, `dx`, `priority:P2`

### What to build

Integrate #1209's delivery mechanism with TanStack Start so a macro-authored route
and Server Function work with automatic catalog loading, isolated SSR state,
and the framework's normal error UI.

### Acceptance criteria

- [ ] The adapter handles server catalog loading and browser locale binding;
      application setup owns no catalog imports, loader maps, or HTML plumbing.
- [ ] Preserve request middleware initialization before Server Function
      execution and isolate locale/time zone across concurrent requests.
- [ ] Initial hydration and lazy route navigation fetch only the active locale's
      required fragments and render compiled plain/rich/plural messages.
- [ ] Fragment and runtime catalog failures reach usable host error handling
      without broken content, including startup and a later navigation.
- [ ] Migrate all TanStack locale-strategy examples and integration guidance;
      verify catalog edits and document navigation for locale changes.

### Blocked by

#1209

## G — [#1211](https://github.com/sebastian-software/palamedes/issues/1211) Deliver Solid messages through the v2 adapter contract

**Type:** AFK
**Labels:** `type:feature`, `dx`, `priority:P2`

### What to build

Integrate #1209's catalog delivery with Solid's rendering and server lifecycle.
Authoring uses macros and supported MDX; the adapter owns loading and uses
Solid/host error handling rather than introducing React-specific requirements.

### Acceptance criteria

- [ ] Automatic active-locale delivery works with Solid's compiled rich-text
      renderer and supported MDX, without parser or eager all-language imports.
- [ ] Request-local state remains isolated while #1207's catalog content is shared.
- [ ] Initial rendering/hydration, lazy navigation, and document locale changes
      are correct; the active module graph drives browser message delivery.
- [ ] Missing fragments and runtime misses display usable host error UI, not
      incomplete translated content, including failure before mounting.
- [ ] Migrate all Solid locale-strategy examples and docs; verify development
      updates through the supported Solid/Vite pipeline.

### Blocked by

#1209

## H — [#1212](https://github.com/sebastian-software/palamedes/issues/1212) Deliver Waku messages through the v2 adapter contract

**Type:** AFK
**Labels:** `type:feature`, `dx`, `priority:P2`

### What to build

Integrate transparent compiled catalog delivery with Waku's RSC, SSR, browser,
and Server Action lifecycles, using the currently declared supported upstream
contract and ordinary host error handling.

### Acceptance criteria

- [ ] Locale resolution remains application policy; catalog loading, client
      binding, and initialization are adapter-owned.
- [ ] RSC/SSR and action requests preserve request isolation, including action
      argument/default evaluation and cross-module translated helpers.
- [ ] No executable catalog functions are serialized through RSC; browser
      modules receive only active-locale fragments for the code they evaluate.
- [ ] Initial and navigation fragment failures and runtime misses reach usable
      host error UI without partially translated content.
- [ ] Migrate all Waku locale-strategy examples and docs; prove development
      invalidation and production browser behavior against the supported Waku API.
- [ ] Document upstream constraints honestly; do not silently retain the old
      parser/all-catalog client path to claim completion.

### Blocked by

#1209

## I — [#1213](https://github.com/sebastian-software/palamedes/issues/1213) Deliver React Router RSC messages through the v2 adapter contract

**Type:** AFK
**Labels:** `type:feature`, `dx`, `priority:P2`

### What to build

Extend the existing React Router RSC entry integration with automatic compiled
catalog delivery through its separate server and browser graphs. Preserve the
request-entry scope contract instead of copying Next body instrumentation.

### Acceptance criteria

- [ ] The RSC request entry resolves locale and installs an isolated runtime
      with adapter-loaded catalogs before handlers and defaults execute.
- [ ] SSR and browser initialization share locale policy without serializing
      executable messages; browser fragments follow the active locale/module graph.
- [ ] Direct and cross-module Server Function messages work with concurrent
      requests, suspension, navigation, and supported revalidation behavior.
- [ ] Initial and later fragment failures reach usable host error handling;
      neither source patterns nor IDs substitute for missing compiled messages.
- [ ] Migrate the focused RSC example, add a lazy browser-message proof, and
      update docs while preserving the declared experimental upstream scope.

### Blocked by

#1209

## J — [#1214](https://github.com/sebastian-software/palamedes/issues/1214) Deliver compiled Remix messages through its asset pipeline

**Type:** AFK
**Labels:** `type:feature`, `stability`, `dx`, `priority:P2`

### What to build

Replace Remix's serialized ICU bootstrap with adapter-owned executable catalog
delivery through its actual browser asset/module pipeline. A macro-authored
interactive page and lazily loaded feature must initialize and render without
browser ICU parsing or application-owned catalog loaders.

### Acceptance criteria

- [ ] Begin with a minimal full-stack proof covering compiled fragment serving,
      module dependency selection, and initial/lazy load failure handling through
      Remix's host error path. Record the concrete integration before broad rollout.
- [ ] Native rendering produces executable message assets; no JSON function
      serialization, runtime ICU parsing, or string-to-code evaluation is used.
- [ ] Browser delivery includes only the active locale and the evaluated code's
      required messages; compiler message usage drives fragment membership.
- [ ] Server catalogs load lazily per locale using #1207's shared-content contract.
      Existing synchronous initialization APIs are migrated explicitly where async
      loading is required.
- [ ] Remove application `loadClientMessages` duplication and manual bootstrap
      catalog plumbing. Locale and ordinary error-UI policy remain application-owned.
- [ ] Verify initial loading, hydration, rich/plural messages, lazy interaction,
      cached import failures, version consistency, and development asset invalidation.
- [ ] Migrate all Remix locale-strategy examples and document supported host
      constraints. If the real asset API cannot meet the target, report a concrete
      blocker instead of substituting the old string transport.

### Blocked by

#1206, #1207, #1144

## K — [#1215](https://github.com/sebastian-software/palamedes/issues/1215) Complete v2 migration and release contract verification

**Type:** AFK
**Labels:** `type:chore`, `packaging`, `dx`, `priority:P2`

### What to build

Make an existing supported 1.x application migratable to the finished v2
contract and verify that the published release artifacts, examples, and guides
agree. This slice integrates the host proofs; it does not defer all testing
or documentation until the end.

### Acceptance criteria

- [ ] Publish a migration guide covering runtime parser APIs, direct raw-ICU
      component usage, entrypoint aliases, compilation gates, source-fallback
      options, manual client loaders/boundaries, server setup, and Remix transport.
- [ ] Verify packaged v2 entrypoints and generated browser artifacts do not
      include the application runtime ICU parser. Build-time tooling still works.
- [ ] CI runs meaningful per-host proofs for the agreed browser/server contract,
      preserving declared upstream support and preview tiers rather than implying
      new platform or catalog-format support.
- [ ] Record aggregate browser payload/network and server memory findings;
      regression checks distinguish unused locales, lazy routes, shared messages,
      warmed catalog reuse, and request-state allocations.
- [ ] Examples and onboarding require no catalog loading plumbing. Error views
      remain usable without failed catalogs and never display internal diagnostics.
- [ ] Release automation and notes designate the coordinated 2.0 transition;
      no breaking changes are accidentally published in 1.x and no permanent legacy
      mode remains. Planning this slice does not authorize publishing a release.
- [ ] Reconcile the historical splitting exploration into living decisions,
      useful tests, and active tracking; retire stale working plans when complete.

### Blocked by

#1208, #1210, #1211, #1212, #1213, #1214, #1139
