# Palamedes Example Matrix

These examples are the strongest visible proof that Palamedes is more than a
single-framework integration.

They prove the current Palamedes story across six server-capable framework
families and four locale strategies while preserving the same underlying
runtime and identity model. A focused Vite example separately proves the
first-class MDX build pipeline.

The matrix is a verification surface, not an assumption that one application
uses all six frameworks. Each example is independently useful as a reference
for its own host and locale strategy.

The matrix is intended to be run locally and validated in CI — that remains the
canonical verification path. The `Example Verification` workflow smoke-tests
all 25 examples on relevant pull requests and `main` pushes. Its weekly run
(and an opt-in manual dispatch) also exercises the 21 browser-capable examples
with Playwright; the four server-first Remix v3 examples remain smoke-only.
Public demo URLs are documented as the live reference surface, but reachability
depends on the hosting and DNS rows in
[docs/demo-deployments.md](../docs/demo-deployments.md).

The server-framework matrix intentionally uses the package-root compatibility
runtime: its ticket panels directly author ICU patterns through `Trans` to test
that fallback surface. The focused Vite MDX example is the end-to-end proof for
the parser-free generated path through the `compiled` entrypoints.

This file is the canonical documentation for the full matrix. Individual
example READMEs are optional and should stay short; add one only when a specific
example needs local setup notes that do not belong in the shared matrix guide.

## What This Matrix Proves

- one i18n mental model across Next.js, TanStack Start, SolidStart, Waku, React Router, and server-first Remix v3
- one runtime story with request-local server i18n plus client interaction
- one message identity story through source-string-first `.po` workflows
- one proof surface with browser verification, screenshots, and SSR checks
- one three-page Vite handbook proving linked, runtime-translated `.mdx` modules

## Focused MDX Proof

[examples/vite-mdx](./vite-mdx) is a standalone React/Vite documentation
application rather than another locale-routing matrix row. Its three linked
MDX pages exercise rich text, expressions, JSX components, translated
attributes, image alt text, code metadata, catalog extraction, production
compilation, and an in-place English/German switch.

Run its full build and browser contract with:

```bash
pnpm verify:examples -- --id vite-mdx
```

That is the real point of the matrix. It is not a pile of demos. It is the
evidence behind the claim that Palamedes stays coherent across frameworks.

## Focused React Router RSC Proof

[examples/react-router-rsc-cookie](./react-router-rsc-cookie) is intentionally
outside the 25-app locale-strategy matrix. It is the production-built fixture
for the experimental React Router RSC adapter: a Client Component invokes a
real `"use server"` Server Function, then proves request-scoped localization,
concurrent English/German isolation, and post-action revalidation.

```bash
pnpm verify:react-router-rsc
```

## Live Reference URLs

The canonical framework-by-strategy URL matrix, reachability notes, and hosting
ownership live in [Demo Deployments](../docs/demo-deployments.md). It is the
source of truth for public URLs because DNS and deployment state can change
without changing the local example contracts.

Try a reachable cookie demo such as
[nextjs-cookie](https://nextjs-cookie.examples.palamedes.dev), or a route demo
such as [Waku in German](https://waku-route.examples.palamedes.dev/de). For how
each strategy encodes and switches locale, see
[Locale Strategies](../docs/locale-strategies.md).

## Locale Strategy Matrix

### Cookie-Derived Locale

- [examples/nextjs-cookie](./nextjs-cookie)
- [examples/tanstack-cookie](./tanstack-cookie)
- [examples/solidstart-cookie](./solidstart-cookie)
- [examples/waku-cookie](./waku-cookie)
- [examples/react-router-cookie](./react-router-cookie)
- [examples/remix-cookie](./remix-cookie)

These examples prove:

- first-visit locale detection from `Accept-Language`
- cookie persistence after an explicit locale switch
- SSR with a request-local Palamedes i18n instance
- `.po` imports in real app builds
- localized server-side actions or server functions

### Route-Derived Locale

- [examples/nextjs-route](./nextjs-route)
- [examples/tanstack-route](./tanstack-route)
- [examples/solidstart-route](./solidstart-route)
- [examples/waku-route](./waku-route)
- [examples/react-router-route](./react-router-route)
- [examples/remix-route](./remix-route)

These examples prove:

- locale in the URL via `/:locale/...`
- host/domain mapping as an extension of the route model
- wrong-locale or wrong-domain detection via a visible info bar
- redirect/switch CTA generation without automatic redirects
- SSR with localized server actions or server functions

### Subdomain-Derived Locale

- [examples/nextjs-subdomain](./nextjs-subdomain)
- [examples/tanstack-subdomain](./tanstack-subdomain)
- [examples/solidstart-subdomain](./solidstart-subdomain)
- [examples/waku-subdomain](./waku-subdomain)
- [examples/react-router-subdomain](./react-router-subdomain)
- [examples/remix-subdomain](./remix-subdomain)

These examples prove:

- the leftmost DNS label as the authoritative locale (`de.<app>` -> `de`), no `/:locale/...` prefix
- `resolve({ strategy: "subdomain", requestHost })` with a base-domain-independent `hosts: { mode: "subdomain" }` config
- `Accept-Language` mismatch detection via the same visible info bar
- locale switching as a full document load to the sibling host (leftmost label swapped)
- SSR with localized server actions or server functions

### TLD-Derived Locale

- [examples/nextjs-tld](./nextjs-tld)
- [examples/tanstack-tld](./tanstack-tld)
- [examples/solidstart-tld](./solidstart-tld)
- [examples/waku-tld](./waku-tld)
- [examples/react-router-tld](./react-router-tld)
- [examples/remix-tld](./remix-tld)

These examples prove:

- the rightmost DNS label (TLD) as the authoritative locale (`.de` → de), no `/:locale/...` prefix
- three-level resolution: automatic when country code equals language code, explicit tld map for others, otherwise `Accept-Language` or default
- the generic `.com` mapped to `en` via an explicit `tld` override (authoritative)
- `resolve({ strategy: "tld", requestHost })` with `hosts: { mode: "tld", tld: { com: "en" }, defaultTld: "com" }`
- locale switching as a full document reload with the TLD swapped
- SSR with localized server actions or server functions

## Shared Runtime Model

All matrix examples use the same public Palamedes stack:

- `@palamedes/core`
- `@palamedes/react` or `@palamedes/solid`
- `@palamedes/runtime`
- `@palamedes/vite-plugin` or `@palamedes/next-plugin`

Remix v3 support is server-first while Remix's component model and asset
pipeline settle. The Remix examples intentionally do not visually match the
React/Solid/etc. matrix yet because the shared `@palamedes/example-ui` package is
React-based and Remix's UI adapter is not implemented. They prove the same
server-side locale strategies, checked-in `.po` catalogs, and request-local i18n
through Remix's default Node loader path.

The matrix does not only prove core/runtime behavior. It also proves
`buildLocaleSwitchItems()` from both first-party UI packages.

Those helpers stay headless on purpose. The examples still own routing, form
submission, and locale policy, but they no longer need to reimplement the same
frontend substrate in each app.

Every non-Remix example also renders the same booking ("Frontend Stage 2026") so
the twenty established UI-adapter apps are visually identical regardless of
framework. The whole visual layer is one shared stylesheet plus one shared
content source, proving that only the markup and locale strategy differ across
frameworks, not the design. Remix v3 currently proves the same server-side
locale strategies with a simpler server-first UI while the Remix UI adapter is
tracked separately:

- [packages/example-ui](../packages/example-ui) — one `styles.css` and the `EVENT` content, loaded by the twenty established UI-adapter apps

The booking surfaces every common i18n need in a real context: translated
copy, plural seat counts, a personalized greeting variable, and locale-aware
number, currency, date, and time formatting through ICU message arguments
(`{amount, number, ::currency/EUR}`, `{when, date, full}`). A locale switch
loads one coherent new document for all of it.

Each demo wires its locale controls through the public
[`@palamedes/core/locale`](../packages/core/src/locale.ts) surface
(`defineLocaleControls`), so locale resolution, the deliberate-choice cookie,
and the suggestion decision are shared library code rather than a per-demo copy.

## Catalog Loading And Bundle Size

Examples should load only the active locale catalog on client-reachable paths.
Use dynamic imports such as `await import(\`../locales/${locale}.po\`)` when
the browser only needs one locale at a time. That gives bundlers a chance to
split catalogs into per-locale chunks.

For Next.js with PO catalogs, prefer the automatic graph-split path demonstrated
by `nextjs-cookie`: enable `messageSplitting: true` and let Palamedes deliver
only the active locale's fragments for the evaluated client module graph.

The `nextjs-route` example combines that import with
`createClientCatalogBoundary()` from `@palamedes/react/client`. The
boundary begins loading the document locale before hydration, holds hydration
until the module is ready, and initializes the hook-free runtime before any
translated Client Component renders. Its locale links deliberately use full
document navigation, so it needs neither live hooks nor static imports of every
catalog.

Static imports are still useful for tiny demos or server-only modules, but they
make every imported locale reachable from that module. In copied app code with
large catalogs, prefer the dynamic import pattern unless all locales are
intentionally needed at once.

## Verification

Workspace-level example builds:

```bash
pnpm build:examples
```

Central example verification:

```bash
pnpm verify:examples
pnpm verify:examples -- --framework nextjs
pnpm verify:examples -- --strategy route
```

Versioned browser screenshots:

```bash
pnpm capture:example-screenshots
pnpm capture:example-screenshots -- --id nextjs-cookie
```

The verifier runs in two layers:

- fast Node-based smoke checks from [scripts/verify-examples.mjs](../scripts/verify-examples.mjs)
- browser interaction checks from `Vitest` using direct `Playwright` automation against the running apps

Together they cover:

- SSR output
- first-visit `Accept-Language` handling
- route-locale rendering
- host/domain mismatch banners
- canonical redirect/switch targets
- locale switching
- localized server action or server function output after interaction

`Example Verification` runs the smoke layer across the complete 25-example
matrix on relevant pull requests and `main` pushes, including the deterministic
request-scope concurrency checks for React Router, SolidStart, TanStack Start,
and Waku. It runs the Playwright layer for its 21 browser-capable examples on a
weekly schedule or when a maintainer selects `run_browser` in manual dispatch.
The four Remix v3 examples are intentionally excluded from that browser layer:
their server-first beta adapter has no shared client-interaction contract yet,
but all four locale strategies are covered by smoke verification.

For the decision model behind cookie, route, subdomain, tld, and domain handling, see:

- [docs/locale-strategies.md](../docs/locale-strategies.md)
- [docs/framework-example-notes.md](../docs/framework-example-notes.md)
- [docs/example-screenshots/README.md](../docs/example-screenshots/README.md)
- [docs/demo-deployments.md](../docs/demo-deployments.md)

## Default Dev Ports

The example scripts use a fixed port layout so the apps can run in parallel:

- `4010` `nextjs-cookie`
- `4011` `nextjs-route`
- `4012` `nextjs-subdomain`
- `4013` `nextjs-tld`
- `4020` `tanstack-cookie`
- `4021` `tanstack-route`
- `4022` `tanstack-subdomain`
- `4023` `tanstack-tld`
- `4030` `waku-cookie`
- `4031` `waku-route`
- `4032` `waku-subdomain`
- `4033` `waku-tld`
- `4040` `react-router-cookie`
- `4041` `react-router-route`
- `4042` `react-router-subdomain`
- `4043` `react-router-tld`
- `4050` `solidstart-cookie`
- `4051` `solidstart-route`
- `4052` `solidstart-subdomain`
- `4053` `solidstart-tld`
- `4060` `remix-cookie`
- `4061` `remix-route`
- `4062` `remix-subdomain`
- `4063` `remix-tld`
- `4070` `vite-mdx`
- `4071` `react-router-rsc` verifier
