# RFC: Code Splitting for Localized Messages

**Status:** Draft / Exploration
**Date:** 2026-08-01
**Owner:** Palamedes maintainers

## Summary

Palamedes applications code-split their functionality, but not their messages.
Today every locale's full compiled catalog lands in the first client bundle,
whether the first route uses those messages or not. The client payload for
messages scales with `locales × total app messages` instead of
`1 × messages of the current view`.

This RFC maps the design space for changing that. It grounds every variant in
what the codebase already provides, because the exploration surfaced something
encouraging: the two hardest ingredients for automatic message splitting —
per-module message usage data and subset catalog compilation — already exist in
the toolchain and are currently discarded or used only for validation.

The headline recommendation is a staged path:

0. give the runtime an explicit loading contract (the real root blocker),
1. make lazy per-locale catalogs the documented default (`L× → 1×`),
2. make messages follow the code through the bundler graph via generated
   sidecar modules — automatic, sync, hydration-safe, no authoring changes,
3. bind the locale dimension at load time (import maps / per-locale sidecar
   emission) so the client fetches `active locale × current route` only,
   with a server-computed inline payload as the equivalent for RSC-style hosts.

Full per-locale build permutation (Angular-style) is kept as an optional
deployment mode that pairs naturally with the `subdomain`/`tld` locale
strategies, not as the primary mechanism. Author-facing namespaces
(the Lingui/next-intl answer) are explicitly rejected.

## Where the weight comes from today

Three layers stack on top of each other. Only the first is app code; the other
two are the library's ceiling on what an app can do about it.

**1. The app layer imports everything eagerly.** Every example ships a
hand-written `lib/i18n.ts` that statically imports all locale `.po` files and
builds an eager `CATALOGS` record reachable from the client entry
(`examples/react-router-cookie/app/lib/i18n.ts:5-35`, repeated across ~20
examples). The Next examples split server from client: the server path already
lazy-imports per locale (`examples/nextjs-cookie/src/lib/i18n.ts:22-25`), the
client path stays deliberately eager.

**2. The module shape is opaque to tree shaking.** A `.po` file compiles to
exactly one module per `(catalog × locale)`. Since ADR-022/023 (2026-08-01/02)
that module is a branded map of executable message functions on the parser-free
compiled ABI:

```js
import { defineCompiledCatalog as __palamedesDefineCompiledCatalog } from "@palamedes/core/compiled"
const __pm0 = (v, r) => r.join("Hallo ", r.value(v, "name"))
export const messages = __palamedesDefineCompiledCatalog({
  ["<idA>"]: "Konstante",
  ["<idB>"]: __pm0,
})
export default { messages }
```

rendered by the native module renderer in `crates/palamedes-node/src/catalog.rs`
(per ADR-022 the single catalog-module generator) and forwarded verbatim by the
Vite plugin, the Next loader, and the Remix load hook. The splitting problem is
unchanged by that upgrade: the catalog is still one branded map literal per
locale, which no bundler can tree-shake per entry, so per-locale dynamic import
remains the best an application can reach — and even that still ships every
message of the locale to every route. What the upgrade does change is the
constraint set for splitting: any split artifact must stay on the compiled ABI
(branded, executable), because the generated production runtime is parser-free
(ADR-023) and rejects unbranded string catalogs.

**3. The runtime has no loading contract.** `load()` is synchronous and
additive, `activate()` assigns a string (`packages/core/src/index.ts:189-196`).
There is no async activation path, no "ensure locale loaded" primitive, no
suspense integration, and no re-render signal when messages arrive after
render. The eager static import in every example is the only hydration-safe
option — the Next client comment says it outright: without it, hydration
throws `"No active client i18n instance"`. Production output strips source
fallbacks by default (ADR-004), so messages that miss their loading window fail
visibly. **Every variant below depends on fixing this layer first.**

### Building blocks that already exist

The exploration found the raw material for automatic splitting already in
place, unused:

- **Per-module usage sets.** `transformMacros(...)` returns `compiledIds` — the
  deduplicated list of every lookup key one source file references
  (`crates/palamedes/src/transform/mod.rs:98-116`, surfaced at
  `packages/transform/src/transform.ts:13`). `analyzeMdx` returns the same for
  MDX. All three host adapters currently discard it
  (`packages/vite-plugin/src/index.ts:502-515`).
- **Subset compilation.** `compileCatalogArtifactSelected(config, resourcePath,
compiledIds)` compiles exactly a given id subset of a catalog
  (`packages/core-node/src/index.ts:580`, core at
  `crates/palamedes/src/catalog_artifact/mod.rs:88-146`). Today it only backs
  MDX missing-translation validation.
- **Native module rendering for arbitrary maps.** Since ADR-022,
  `renderCatalogModule(messages)` renders any id→pattern map into the branded
  executable module source on the compiled ABI. Composed with the selected
  compile, subset artifacts become subset _modules_ in two existing calls —
  precompiled, parser-free, and per locale.
- **Additive runtime loading.** `i18n.load(locale, partial)` already merges
  (`packages/core/src/index.ts:189-192`), so chunked registration does not
  clobber earlier chunks.
- **A reserved injection point.** `NativeTransformResult.prepend_text` exists
  and is always `None` — a natural home for injecting a sidecar import during
  transform, on the Rust side of the source-map generation.
- **Per-file extraction data.** The extraction cache (ADR-019) and PO `#:`
  references both map files to messages, though in source-string space and
  with durability caveats; `compiledIds` from the transform is the
  authoritative signal because the plugin computes it anyway, per module, in
  compiled-key space.

What does **not** exist anywhere: a route concept, a module-graph view (only
the bundler has one), any persisted manifest, any config surface for output
granularity, and any CLI compile command (compilation happens only inside
bundler loaders via NAPI).

## Design axes

Every proposal below is a point in a small number of dimensions. Naming them
keeps the variants comparable:

1. **When the locale binds.** At build time (one artifact set per locale), at
   load time (locale-neutral code selects locale-specific message assets), or
   at runtime (all locales shipped; the status quo).
2. **The split unit.** Whole app → locale → route → chunk → module → single
   message.
3. **Who decides membership.** The author (namespace declarations), the
   framework (route manifests), the bundler (module graph), or the toolchain
   (per-module usage sets). Palamedes' model rules out the first: source-string
   identity deliberately has no author-facing grouping key (ADR-003/004), and
   adding one would reintroduce exactly the ID sprawl the product removed.
4. **The delivery channel.** Static import (sync, hydration-safe by
   construction), dynamic import (async, needs a loading contract), HTTP JSON
   (cacheable, CDN-friendly, async), server-inlined payload (zero extra
   requests, server-first hosts), or import-map indirection (static import
   syntax, load-time binding).
5. **Deduplication.** Messages shared across split units: duplicate them,
   hoist them into shared assets (bundlers do this for modules), or refuse to
   split below the sharing boundary.

Constraints carried over from the ADRs: identity stays source-string-first
(ADR-003), compiled keys stay internal (ADR-004), the runtime primitive stays
`getI18n()` (ADR-005), Rust compiles artifacts while adapters render modules
(ADR-011), and adapters stay thin orchestration layers (ADR-008). Translator
workflow is a hard invariant: catalogs remain whole `.po`/FCL files; splitting
is a compile/build concern and must never leak into authoring or translation.

## Stage 0 (prerequisite): a runtime loading contract

Not a variant — the enabler for all of them. Smallest sufficient surface:

- **A shared message store with a revision.** Message registration moves to a
  store that instances read through (today catalogs live inside the
  `createI18n` closure). `load()` keeps its signature, bumps a revision, and
  the existing `subscribeClientI18n` reactivity
  (`packages/runtime/src/index.ts`) notifies on message arrival, not only on
  instance replacement. This makes late-arriving chunks re-render correctly
  and lets sidecar modules register messages before any instance exists.
- **A loader registry + `ensureLocale(locale): Promise<void>`.** Adapters (or
  apps) register how a locale's messages are fetched; the runtime dedupes and
  tracks in-flight loads. `activate()` stays sync; an async `activateLocale()`
  convenience awaits `ensureLocale` first.
- **Framework wiring.** React: a suspense-compatible read (throw the in-flight
  promise) plus the existing `useSyncExternalStore` bridge. Solid: the signal
  bridge already exists. Server entries for the initial locale must resolve
  before hydration — route loaders or inline bootstrap, per adapter.

This stage has standalone value even if no further splitting ships: it is what
the "Larger apps would dynamically import per-locale chunks instead" comment in
twenty examples silently assumes and the runtime currently cannot honor.

## Variant catalogue

### V1 — Lazy per-locale catalogs

**Idea.** Keep one module per `(catalog × locale)`, stop importing all of them.
`await import(`../locales/${locale}.po`)` behind `ensureLocale`; other locales
load on switch.

**Payload.** `L× → 1×` on first load. All messages of the app still ship for
the active locale.

**Cost.** Small: Stage 0 plus adapter helpers plus rewriting the example
`i18n.ts` pattern. No bundler machinery, framework-neutral, works everywhere
including Remix's Node loader. `docs/troubleshooting.md` and
`examples/README.md` already recommend exactly this without the runtime
support to make it hydration-safe.

**What this stage actually is.** Not a new capability — real applications
hand-roll this today, and the bundler side works fine. What they carry
themselves, because the library offers no contract for it: hydration ordering
(load+activate must complete before `hydrate()`), a re-render signal for
late-arriving messages (`load()` bumps no revision, so post-render locale
switches only repaint via re-installing the instance or a full reload),
in-flight dedup for rapid switches, and the failed-fetch error path. Stage 1
is the library catching up with its users — and the examples catching up with
the docs, which recommend the lazy pattern the examples themselves avoid.

**Verdict.** Not the destination, but the correct first step and the fallback
story for hosts where graph-based splitting is unavailable. For teams already
hand-rolling lazy locales, the payload win starts at Stage 2, not here. The
eager pattern remains valid for tiny catalogs; the docs should present both as
sanctioned modes with a size threshold rule of thumb.

### V2 — Messages follow the code (bundler-graph sidecar modules)

**Idea.** During transform, every module that uses messages gets one appended
import of a generated sidecar module (append rather than prepend keeps the
native source map valid; imports hoist anyway):

```js
// appended to Checkout.tsx after macro transform
import "virtual:palamedes/messages/f3a9c1" // hash of module id
```

The plugin resolves that id, calls `compileCatalogArtifactSelected` with the
module's `compiledIds`, renders each locale's subset through the native
`renderCatalogModule` (one per-locale virtual module, so the artifact stays on
the branded parser-free compiled ABI of ADR-022/023), and aggregates them in a
registration module:

```js
import { messages as en } from "virtual:palamedes-messages/f3a9c1/en"
import { messages as de } from "virtual:palamedes-messages/f3a9c1/de"
import { registerMessages } from "@palamedes/runtime"
registerMessages({ en, de })
```

The per-locale granularity is not incidental: those per-locale modules are
exactly the unit V4b later binds through import maps.

**Why this shape wins mechanically.** The bundler now treats messages as what
they are: dependencies of the code that uses them. Route-level code splitting
splits messages with zero route knowledge in Palamedes; dynamically imported
features carry their messages in their own chunk; eagerly imported code keeps
its messages in the entry. Registration happens at module evaluation, so by
the time a component renders, its messages are present — synchronous,
hydration-safe by construction, no suspense needed for the code-split path.
`compiledIds` and subset compilation make the per-module artifact cheap, and
the extraction cache discipline (ADR-019) already establishes the invalidation
pattern: on a `.po` change, invalidate only the sidecars whose id sets
intersect the changed entries (the plugin holds `moduleId → compiledIds` and
can invert it).

**Caching behavior** is a quiet highlight: translation-only changes invalidate
only sidecar chunks, never code chunks, so app deploys after a translation
sync keep code-chunk cache hits.

**Open problems, honestly stated:**

- **Locale dimension.** The plain form embeds all locales in each sidecar. The
  route subset shrinks, but each subset ships `L` times. With 2–3 locales and
  route subsets around 10–20% of the app's messages this already beats V1
  (e.g. 3 locales × 15% = 45% of one full catalog vs. V1's 100%), but it
  reintroduces the `L` factor V1 removed. V4b below removes it cleanly; the
  two compose.
- **Duplication across sidecars.** A message used in five files appears in
  five sidecars. Bundler hoisting dedupes _modules_, not object entries.
  Mitigation (a): accept and measure — shared strings tend to be short UI
  chrome, and chunk-level hoisting still collapses sidecars that end up in the
  same chunk only if identical. Mitigation (b), the **V2b refinement**: the
  sidecar imports one generated atom module per message
  (`virtual:palamedes/m/<compiledId>`), each registering a single message.
  Atoms have module identity, so the bundler hoists a shared message into a
  shared chunk exactly once — Paraglide's message-modules insight transplanted
  into the registry model without touching authoring or runtime contracts. The
  price is module-graph size: one module per used message (6,000 messages =
  6,000 graph nodes). Rollup/Rolldown handle this scale, but build time and
  dev-server module counts need a measured verdict, not a guess. A pragmatic
  middle: atoms only for messages referenced by more than one module —
  computable from the inverted id index.
- **Module count.** One sidecar per message-bearing file. On the benchmark
  corpus (1,500 files) that roughly doubles the transformed-module count.
  Needs measurement in the spike; Vite dev with per-file sidecars may want the
  dev server to skip splitting entirely (dev already keeps source fallbacks —
  eager full catalogs in dev, split in build, is a legitimate simplification).
- **Dynamic message ids.** `i18n._(someVariable)` cannot be attributed to a
  module's id set statically. Escape hatch: such messages fall into a
  _residual catalog_ loaded per locale like V1, and the audit surface reports
  them (`pmds audit` already exists as the diagnostic home).
- **ADR-011/022 alignment.** Subset selection, compilation, and module
  rendering all stay native (ADR-022 makes the native renderer the single
  catalog-module generator); the adapter only orchestrates — transform,
  selected compile, native render, and the thin registration wrapper. No
  second JavaScript module generator appears.
- **Brand preservation.** Registration must not degrade the branded compiled
  catalogs to plain maps: the parser-free runtime rejects unbranded string
  catalogs (ADR-023), so `registerMessages` and any buffer merge must keep
  the `defineCompiledCatalog` brand intact (register per branded map rather
  than spread-merging into anonymous objects). This is a real constraint the
  spike below did not yet meet.

**Verdict.** The core of the proposal. Automatic, model-preserving, and built
almost entirely from parts that already exist.

### V3 — Route-manifest artifacts (explicit, framework-driven)

**Idea.** Attribute messages to _emitted chunks_ rather than source modules:
collect `moduleId → compiledIds` during transform, then in `generateBundle`
walk each chunk's module list, union the ids, and emit one asset per
`(chunk × locale)` plus a manifest. Route loaders (TanStack/React Router
loaders, Next segment loading) call `ensureMessages(chunkOrRoute)` before
render; assets can be JS modules or plain JSON on a CDN.

**Compared to V2.** Same data, different delivery: V2 lets the module graph do
the distribution implicitly and synchronously; V3 makes it explicit, async,
and framework-wired. That buys HTTP/CDN delivery, per-locale assets without
import-map machinery (the loader interpolates the locale into the asset URL),
and independence from module evaluation order — at the cost of per-framework
wiring, a manifest to version, an await on every route transition, and
hand-rolled dedup (a "common" asset for messages shared above a threshold,
i.e. reimplementing what the bundler does for free in V2).

**Verdict.** Not the primary path, but the right _delivery mode_ for two real
cases: teams that want messages on a CDN outside the JS pipeline, and as the
mechanical substrate for V6 (the server needs exactly this attribution to
compute route payloads). Design the chunk-attribution pass once; let V3 and V6
share it.

### V4 — Binding the locale earlier

The user-visible locale dimension, attacked at two different binding times.

**V4a — Full per-locale build permutation (Angular-style).** Run the bundler
once per locale; the transform inlines translations at the call site
(precompiled ICU: plain strings become literals, parameterized messages become
compact precompiled patterns or functions). No catalogs, no lookup, no
registry: message splitting is perfect _by construction_ because messages are
code. Dead-locale elimination is automatic.

Costs are equally structural: `L×` build time and artifact storage;
translation changes invalidate code chunks (bad deploy-cache behavior — the
mirror image of V2's caching win); locale switching becomes a full
navigation; and the transform needs catalog access at transform time (today
the two pipelines are deliberately separate). The heaviest ingredient,
however, already landed independently: ADR-022's message-program lowering
compiles ICU into executable JavaScript functions in the native renderer, so
V4a no longer needs to invent precompilation — it needs to inline the
already-compiled function at the call site instead of looking it up in a map.

What redeems it: Palamedes already ships `subdomain` and `tld` locale
strategies where each locale lives on its own origin and switching _is_ a
navigation. For those deployments, per-locale artifacts are not a workaround
but the natural shape, and Vite's environments API (the road Paraglide 2 took
with per-locale graphs) makes the build mechanics tractable. **Positioning:
an optional deployment mode for origin-per-locale setups, not the general
mechanism.**

**V4b — Load-time binding via import maps (per-locale sidecars, one app
build).** Keep the app build locale-neutral (V2 sidecars), but emit the
sidecar _contents_ per locale and let the HTML bind the locale:

- sidecar imports use a bare specifier per sidecar (`#pmds/f3a9c1`),
- the build emits `f3a9c1.en.js`, `f3a9c1.de.js`, … (subset compile per
  locale — the primitive already takes a locale-specific resource path),
- the server/adapter injects a per-locale import map resolving each specifier
  to the locale's file; SSR knows the locale before it writes the HTML in
  every supported strategy (cookie, route, subdomain, tld).

Result: static import syntax (sync, hydration-safe), bundler-driven
membership, and the client downloads `1 locale × current route's messages` —
the theoretical optimum for a catalog-based runtime — from a single app
build. Costs: import maps must be injected before any module loads (fine for
SSR'd documents; harder for pure static hosting of a locale-agnostic
`index.html`); locale switching without navigation needs a fallback (accept a
reload, or fall back to dynamic ensure for post-load switches); and emitting
per-locale variants of sidecar chunks needs either bundler cooperation
(emit-per-locale in `generateBundle`) or a cheap secondary pass over sidecars
only. Browser support for import maps is no longer the constraint it was.

**Verdict.** V4b is the designated endgame for SPA-shaped hosts, deliberately
staged _after_ V2 proves the sidecar mechanics; V4a is a niche mode that
shares the ICU-precompilation investment but should not gate anything.

### V5 — Per-message compiled functions (Paraglide-style)

**Idea.** Compile every message into its own exported function; the transform
rewrites call sites to import and call it. Tree shaking then operates at
message granularity and the "loading" question dissolves — messages are code.

**Why not as the primary model.** It replaces the catalog-registry runtime
with a distributed one: `getMessageNodes`/`<Trans>` rich-text rendering, the
`onMissing`/`reportError` surface, pseudo-locale, and the loading contract all
have to be rethought per generated function, and the runtime contract of
ADR-005 stops being the single seam. Payload-wise it embeds all locales at
each function (or reopens the same per-locale binding question as V4b) and
pays function boilerplate per message. Its genuine advantage — bundler-native
dedup of shared messages — is available inside the catalog model as V2b atoms.

**Verdict.** Mined for its insight, rejected as a model shift with marginal
residual benefit over V2b + V4b.

### V6 — Server-computed payloads (RSC / server-first inline)

**Idea.** On server-first hosts, stop shipping message JS to the client
entirely. Server-rendered text needs no client messages at all; what
hydrating client components need is exactly the union of `compiledIds` of the
client modules in the current route tree — computable at build from the same
attribution pass as V3. The adapter emits that subset per
`(route segment × locale)` and the server inlines it into the HTML/RSC payload
as bootstrap data; `setClientI18n` initializes from it. Zero extra requests,
exact used-set, hydration-safe by construction.

**Cost.** Per-framework integration depth (Next App Router first — its
examples already split server/client instances and lazy-load on the server;
then Waku, then server-first Remix v3). Client-side navigations must deliver
segment payload deltas the same way the host delivers RSC payloads.

**Verdict.** The correct shape for the RSC end of the framework matrix — where
V2's "messages ride in code chunks" partially dissolves because much of the
code never reaches the client. Shares its attribution machinery with V3.

### V7 — Critical-path inlining (sketch only)

Inline the first-paint message subset into the HTML (computed from the entry
chunk's ids, or measured), defer the rest as one lazy per-locale chunk. A
pragmatic 80/20 that composes with V1 and needs almost nothing new. Worth
keeping in the drawer as an interim optimization for apps that adopt Stage 0/1
but not graph splitting; not worth its own machinery beyond that.

## Cross-cutting concerns

- **Translator workflow is untouched by design.** Every variant splits at
  compile/build time; `.po`/FCL catalogs stay whole. This is the deliberate
  contrast to the namespace-declaration answer (Lingui catalogs config,
  next-intl `pick`-per-page), which moves splitting into authoring and
  translation surfaces and rots as routes evolve.
- **Parser-free discipline (ADR-023).** Every split delivery mechanism that
  ships message _data_ as JS must emit the branded compiled ABI via the native
  renderer; plain string maps would either re-import the ICU parser into the
  browser (defeating the parser-free win) or be rejected by the parser-free
  Core factory. Mechanisms that ship JSON over HTTP (V3/V6 delivery modes)
  need an explicit answer: either server-side rendering into compiled modules,
  or a deliberate opt-in to the compatibility parser path.
- **Fallback chains.** Subset compilation must resolve `fallbackLocales` at
  build into each emitted artifact (the primitive already resolves chains —
  `resolved_locale_chain` in `CatalogArtifactResult`), so the runtime never
  needs a second request to satisfy a fallback.
- **Missing translations.** Production strips source fallbacks by default, so
  split artifacts inherit the existing `failOnMissing` gate; nothing new, but
  the gate must run per emitted artifact, not only per whole catalog.
- **Dev mode.** Dev keeps source fallbacks and tiny latencies; serving eager
  full catalogs in dev and splitting only in build is a legitimate and much
  simpler default, provided a `build --debug`-style path exists to debug the
  split output itself.
- **Pseudo-locale** rides the same rails as any locale in every variant except
  V4a, where it doubles build permutations — one more reason V4a stays
  optional.
- **Watch/HMR.** The inverted index (`compiledId → sidecars`) scopes `.po`
  edits to affected sidecars; the extraction cache already demonstrates the
  per-file invalidation discipline and holds in watch mode.
- **Proof.** The repo's culture is checked-in evidence. This work should land
  with a bundle-size lane in the benchmark/report structure: first-load
  message bytes (raw + gzip) per example, before/after per stage, so the
  website can quote measured numbers instead of the estimates below.

## Comparison at a glance

|                    | First-load messages          | Locale switch     | Build cost        | Hydration     | Coupling        | Author effort  |
| ------------------ | ---------------------------- | ----------------- | ----------------- | ------------- | --------------- | -------------- |
| Status quo         | all locales × all messages   | instant           | —                 | sync          | none            | none           |
| V1 lazy locale     | 1 locale × all               | async fetch       | none              | needs Stage 0 | none            | pattern change |
| V2 sidecars        | all locales × route          | instant           | plugin pass       | sync ✓        | bundler only    | none           |
| V2b + atoms        | all locales × route, deduped | instant           | + graph size      | sync ✓        | bundler only    | none           |
| V3 route manifest  | 1 locale × route             | async fetch       | emit pass         | needs await   | per framework   | none           |
| V4a permutation    | 1 locale × route (inlined)   | navigation        | × L builds        | sync ✓        | build infra     | none           |
| V4b import maps    | **1 locale × route**         | reload or ensure  | + per-locale emit | sync ✓        | SSR injects map | none           |
| V5 per-message fns | all locales × used           | instant           | compiler          | sync ✓        | model shift     | none           |
| V6 server inline   | **exactly used client set**  | server round trip | attribution pass  | sync ✓        | deep per host   | none           |

Order-of-magnitude sizing, explicitly an estimate to be replaced by the
benchmark lane: at the realistic-corpus scale (6,000 messages), a compiled
per-locale catalog is roughly 400–500 KB of module source, on the order of
60–100 KB gzipped. Three eager locales put all of that ×3 in the entry today.
V1 divides by the locale count; V2/V4b reduce the remainder to the current
route's share — commonly 10–20% for a first route in a route-split app.

## Recommendation and staging

Each stage ships value alone and none forecloses the later ones:

- **Stage 0 — runtime loading contract.** Shared message store with revision,
  `ensureLocale` + loader registry, suspense/await wiring per framework.
  Unblocks everything; fixes the documented-but-unsupported lazy pattern.
- **Stage 1 — V1 as the sanctioned default.** Adapter helpers, docs, examples
  flipped to lazy per-locale with an explicit "tiny catalogs may stay eager"
  rule. Cuts the locale factor with trivial machinery.
- **Stage 2 — V2 sidecar splitting in the Vite plugin** behind a config flag
  (working name: `splitting: "graph"`), all-locales-embedded first because it
  is sync and simple; spike measures module-count overhead, sidecar
  duplication rate, and dev-server impact on a real example; V2b atoms if the
  duplication measurement says so. Next/Turbopack follows once the Vite shape
  settles.
- **Stage 3 — bind the locale.** V4b import-map binding for SPA-shaped hosts;
  V6 server-inlined payloads for the RSC end, sharing the chunk-attribution
  pass with a V3-style manifest mode for CDN delivery.
- **Optional, later.** V4a permutation builds as a deployment mode for
  `subdomain`/`tld` setups; V7 critical-path inlining if real apps want a
  cheaper interim step.
- **Explicitly not doing.** Author-facing namespaces or catalog-per-route
  authoring conventions (violates the source-string-first model and rots);
  V5 as a runtime-model replacement.

The through-line: **membership is decided by the bundler graph, locale binding
is decided by the host, authors decide nothing.** That division is what the
existing architecture — per-module `compiledIds`, subset compilation, thin
adapters, one runtime — was already shaped for, even if nothing wires it
together yet.

## Open questions

1. NAPI call granularity for sidecar compilation: one
   `compileCatalogArtifactSelected` per module is the simple start; a batched
   `compileCatalogArtifactsForModules(map)` may be warranted — measure before
   adding surface (ADR-009 favors workflow-shaped native ops).
2. Where sidecar import injection lives: fill `prepend_text` natively
   (source-map-clean, one less JS concern) or append in the plugin
   (source-map-neutral at EOF). Leaning native.
3. Whether `registerMessages` becomes public API or stays an internal runtime
   entry only generated code imports (ADR-004 suggests internal).
4. Chunk-attribution timing in Vite: `generateBundle` sees final chunks but
   runs late; Rolldown/Vite 8 environment hooks may offer a cleaner seam —
   verify against the Vite versions the plugin supports.
5. Remix v3's Node loader has no bundler graph; V1 + V6-style server payloads
   are likely its whole story — confirm with the smoke setup.
6. Interaction with `keepSourceFallbacks: true` apps: sidecars make fallback
   stripping safer (messages provably arrive with the code) — could stripping
   become unconditional in split mode?
7. Sidecar × locale module fan-out on the ADR-022 renderer: one
   `renderCatalogModule` call and one virtual module per (source file ×
   locale) is the composable start, but a batched native "render registration
   module for these locales" op would halve the module count — same
   measure-before-adding-surface rule as question 1.

## Appendix: Stage-2 spike results (2026-08-01)

A working V2 prototype exists on this branch, built against the ADR-022/023
runtime (rebased onto `7e697a1`). What was built:

- **Runtime**: `registerMessages(catalogs)` in `@palamedes/runtime` — loads
  into the active client instance when one is installed, buffers otherwise;
  `setClientI18n` flushes the buffer. Each registered map is buffered and
  loaded **as-is, never copied or merged** — generated catalogs carry the
  compiled-catalog brand and the parser-free runtime rejects unbranded
  copies; cross-registration merging is `load()`'s job (which the ADR-022
  core already does per entry). Registrations survive `resetI18nRuntime()`
  (module-evaluation facts, mirroring the framework bindings' listener
  stores). Five new tests.
- **Vite plugin**: `experimentalGraphSplitting` option — the transform hook
  records each module's `compiledIds` and appends a
  `import "virtual:palamedes-messages/<hash>"` (append keeps the native source
  map valid). The sidecar plugin serves two module levels: per (source file ×
  locale) a subset module produced by `compileCatalogArtifactSelected` + the
  native `renderCatalogModule` — so split artifacts are branded, precompiled,
  and parser-free — plus one aggregator that imports the per-locale modules
  and registers their exports. `failOnMissing` and watch files honored.
  Six new tests. (Pseudo-locale was skipped in the first iteration; see the
  hardening appendix — it never needed to be.)
- **Example**: `examples/react-router-cookie` gained a second route
  (`/insights`) with its own messages, a shared message with home, client
  bootstrap without any catalog import (`lib/i18n.ts`), and server-only eager
  catalogs in `lib/i18n.server.ts`.

Measured on that example (2 routes, 3 locales, 37 messages), production build
on `7e697a1`, fair baseline = same two-route app with eager static catalog
imports, both sides on the compatibility factory (see the parser note below):

|                               | eager baseline                                    | graph splitting                           |
| ----------------------------- | ------------------------------------------------- | ----------------------------------------- |
| shared chunk (`jsx-runtime`)  | 139.65 kB (46.38 gzip) — carries **all** messages | 134.34 kB (44.21) — carries none          |
| `home` route chunk            | 6.85 kB (1.85)                                    | 11.37 kB (3.23) — its messages ride along |
| `insights` route chunk        | 2.46 kB (0.86)                                    | 4.24 kB (1.52) — its messages ride along  |
| `LocaleSwitcher` shared chunk | 4.86 kB (2.28)                                    | 4.97 kB (2.33)                            |
| messages loaded on `/`        | all routes × 3 locales                            | home's own × 3 locales                    |

The dynamic messages inside those route chunks are the ADR-022 executable
functions (`(v,r)=>r.plural(...)` visibly inline in the emitted chunks), not
ICU strings. Summed route-side message payload (4.52 + 1.78 + 0.11 kB) versus
the shared-chunk delta (5.31 kB) puts the split overhead — cross-route
duplication ×3 locales plus aggregator imports — at roughly 1.1 kB raw here;
it amortizes as the route count grows.

**Parser note.** With splitting active, the catalog path contributes no parser
dependency: swapping the example's `createI18n` to `@palamedes/core/compiled`
moved the `[palamedes:icu-parser]` sentinel out of the shared chunk while all
sidecar-fed messages (including plurals) kept rendering. The example
nevertheless stays on the compatibility factory, because its proof panels
format _raw_ ICU patterns through the plain `Trans` component at runtime —
which is exactly the compatibility case ADR-023 keeps the parser for, and
orthogonal to splitting. Fully parser-free split apps need both the compiled
factory and no raw-ICU compatibility components.

Absolute deltas are tiny at demo scale; the structural property is the point:
`/` no longer downloads `/insights`' messages, and message payload now scales
with the route instead of the app. Sidecar stats: 5 sidecars over 12 app
files; 41 references to 37 unique messages; 4 messages (10.8%) live in two
modules each — two of those collapse into the same chunk anyway, and the
remaining cross-route duplication is the V2b atom candidate.

Browser-verified on the production build: SSR renders localized, hydration is
clean (no console errors), a client-side locale switch re-renders without a
reload from sidecar-registered messages (buffer flush path), and navigating to
the other route lazy-loads that route's chunk together with its messages
(network-verified).

Corrections the spike feeds back into the body above:

1. **Sidecars inline into their importer's chunk** when they have a single
   importer, so a translation-only change re-hashes the route chunks that use
   the changed message — not a separate message asset. A later design pass
   sharpened this further: emitting sidecars as their own chunks does **not**
   restore the cache property either, because ESM chunks reference each other
   by hashed filename — a changed message chunk changes the import specifier
   inside its importer, and the hash cascades up the static import chain. The
   only thing that breaks that chain is name indirection: a bare specifier in
   the code chunk plus an import map (or manifest-driven loader) carrying the
   hash. In other words, the caching property and the load-time locale
   binding are the _same_ mechanism — V4b is not an optimization on top of
   separate message chunks; it is the step that makes them meaningful.
2. **The runtime contract needed for V2 alone is smaller than Stage 0**: no
   async `ensureLocale`, no suspense — module evaluation always precedes
   render, so buffer + flush suffices. Stage 0 in full remains the
   prerequisite for V1/V3, not for V2.
3. **Unrelated pre-existing finding**, hit while verifying: transformed macro
   calls inside react-router _actions_ crashed in production because
   `@palamedes/react/runtime` exported a hook-shaped `getI18n`
   (`useSyncExternalStore` outside render). Reproduced identically on an
   unmodified eager build — and fixed on this branch: the hook exists only to
   subscribe and its return value is unused, so server environments now
   resolve the runtime getter directly (`typeof window` branch at module
   scope), mirroring what the `react-server` condition already does for RSC.
   Verified end to end: the example's server action renders its translated
   proof message in the production build. Solid is unaffected (signal read,
   no dispatcher).

### Addendum (2026-08-02): rebased onto ADR-022/023 and reworked

The spike originally ran against the pre-ADR-022 base (`488caaf`); main then
moved generated catalogs to branded executable message functions with a
parser-free production runtime (`6f5c55f`…`7e697a1`). The branch was rebased
onto `7e697a1` and the spike reworked; the numbers and description above are
from the rebased state. What the upgrade changed:

- **The mechanism came out stronger.** The two-call pipeline the sidecars
  need — `compileCatalogArtifactSelected` + `renderCatalogModule` — now
  exists natively end to end, and main independently built the precompilation
  half that this RFC's V4a/V2 sections previously listed as new machinery.
- **Two spike pieces had to change shape**, both now done: sidecar rendering
  moved from plugin-rendered JSON (unbranded — rejected by the parser-free
  runtime) to native-rendered per-locale modules plus an aggregator, and the
  `registerMessages` buffer became brand-preserving (maps buffered and loaded
  as-is instead of spread-merged; the ADR-022 `load()` merges per entry).
- **Browser-verified again on the rebased production build**: SSR localized,
  hydration clean, client-side locale switch without reload through the
  buffered branded catalogs, route navigation lazy-loading the route chunk
  with its messages, plurals rendering from compiled functions.
- The main-branch runtime refactors did **not** change the pre-existing
  hook-`getI18n` action crash; it reproduced identically on `7e697a1` and is
  now fixed on this branch (finding 3 above).

## Appendix: Stage-3 spike results (2026-08-02, import-map binding)

V4b works. Built on top of the Stage-2 sidecars, behind the extended flag
`experimentalGraphSplitting: { localeBinding: "import-map" }`:

- **Plugin.** In production client builds the aggregator imports one
  locale-neutral bare specifier (`#pmds/<key>`), marked external; SSR builds
  and dev servers keep the embedded form. `generateBundle` emits one
  dependency-free message asset per (sidecar × locale) — derived from the
  native renderer's output, with a `locale` export and no imports; branding
  happens on receive in the aggregator via `defineCompiledCatalog` — plus one
  import map per locale and a `palamedes-split-manifest.json`. Emission is
  sorted for build determinism.
- **Example.** The server splices the active locale's import map into the
  HTML stream directly after `<head>`. That placement is load-bearing: React
  19 hoists modulepreload links above anything a route component renders, and
  an import map that loses that race is silently rejected, killing the module
  graph — reproduced as an intermittent dead page before the injection moved
  into `entry.server`. Locale switching became a document navigation
  (`<Form reloadDocument>`), the documented V4b trade.

Verified on the production build in a browser:

- **`1 locale × route` is real.** First load of `/` fetches exactly the four
  home-route message assets of the active locale — zero assets of other
  locales. Client-side navigation to `/insights` fetches exactly one more
  asset: that route's messages in the active locale. Locale switches load the
  new locale's assets via the new document's import map; hydration and
  client-side interactivity verified after warm-cache switches across
  de/en/es.
- **Translation-only deploys keep code chunks byte-identical.** Changing one
  German translation and rebuilding changes exactly one `.de` message asset
  and the `.de` import map; every code chunk, every other locale's assets and
  maps keep their hashes. Rebuilding without changes reproduces the bundle
  bit-for-bit (after sorting emission; unsorted, transform order leaked into
  map hashes).

Follow-up done (2026-08-02): the manifest now records which chunk imports
which bare specifier (`chunkImports`), and the example's stream injector
emits `<link rel="modulepreload">` for the mapped assets of the chunks the
document already preloads — measured in the browser, message assets start in
the same millisecond as the route chunk instead of one waterfall step later.
Still open: the manifest-reading server helper is example-code that belongs
in an adapter surface, and non-navigation locale switching would need an
async ensure path (Stage 0 territory).

## Appendix: hardening pass (2026-08-03)

Three items from the Stage-2 gap list, each checked against reality rather
than against the assumption that produced it:

- **MDX now splits like macros do.** `analyzeMdx` reports the same
  `compiledIds` the macro transform does, so MDX modules get the same sidecar
  import; both paths share one helper. Verified on `examples/vite-mdx`, which
  now runs with splitting and imports no catalog at all: prose, rich text and
  attribute translations render, and the locale switch works across all three
  pages.
- **Pseudo-locale was never actually blocked.** The first iteration skipped it
  "because the selected compile has no generated-pseudo path". Probing the
  native binding directly disproved that: `compileCatalogArtifactSelected`
  pseudolocalizes through the same `build_artifact_result` path as the full
  compile, resolving the catalog through the fallback chain
  (`pseudo → en` yields `[!! Àŧŧéñðàñçé ïñšïğĥŧš······ !!]`). The one real
  constraint is that the catalog file must exist — and `pmds extract` writes
  `pseudo.po` like any other configured locale. The skip is gone; pseudo is a
  locale like the others.
- **No hot-update hook is needed for dev.** A `handleHotUpdate` that
  invalidated every sidecar of a changed catalog was written, then deleted
  after a counterfactual test: with the hook removed and the plugin rebuilt,
  editing a German translation in a running dev server still repainted the
  browser. The sidecars' `addWatchFile` calls already establish the dependency
  Vite invalidates on. A test now pins those watch registrations, since that
  is what dev-mode updates actually rest on.

Found while verifying, unrelated to splitting: the MDX example's **dev server
is broken on Vite 8** — `vite:import-analysis` cannot parse the JSX the MDX
transform returns, so the page stays empty (production builds are fine).
Reproduced identically with splitting disabled; tracked separately.

## Prior art (references, not blueprints)

- **Paraglide JS 2** — message-modules build output for tree shaking;
  experimental per-locale builds on Vite environments; middleware locale
  splitting for SSR. Closest relative of V2b/V4a; differs by having no
  catalog runtime at all.
- **Lingui** — per-locale compiled catalogs, lazy activation, optional
  multiple catalogs via path-scoped config (author-declared grouping).
  V1's shape; the grouping approach this RFC rejects.
- **next-intl** — runtime JSON messages, author-side `pick` per
  page/namespace. The maintenance profile the through-line above avoids.
- **Angular `$localize`** — the canonical V4a: build-time inlining, one
  artifact set per locale.
- **Import maps** — the load-time binding mechanism behind V4b; widely
  supported in current browsers.
