# @palamedes/remix

Remix v3 server and browser asset integration for Palamedes.

## Installation

```sh
pnpm add @palamedes/core @palamedes/core-node @palamedes/remix @palamedes/runtime remix
```

`@palamedes/core` must be a direct runtime dependency because generated catalog
modules import `defineCompiledCatalog()` from its `compiled` entrypoint.
`@palamedes/core-node` is needed when generating serializable browser catalogs
with `compileCatalogArtifact()` as shown below.

Use this package with Remix v3's default Node loader path. Register Remix's TSX
loader first, then Palamedes:

```sh
node --import remix/node-tsx --import @palamedes/remix/register server.ts
```

The order is load-bearing. If `@palamedes/remix/register` is registered before
`remix/node-tsx`, Remix short-circuits the TS/TSX load and Palamedes macros can
reach runtime as untransformed stubs.

The register hook composes with `remix/node-tsx`, receives the JavaScript source
that Remix compiled from `.ts` and `.tsx` files, and runs the Palamedes macro
transform before Node executes the module.

For browser-delivered modules, install the post-compile asset loader and allow
the generated runtime import:

```ts
import { createPalamedesRemixAssetLoader, PALAMEDES_REMIX_ASSET_PACKAGES } from "@palamedes/remix";
import { createAssetServer } from "remix/assets";

const assetServer = createAssetServer({
  basePath: "/assets",
  allowFiles: ["app/routes.ts", "app/**/public/**"],
  allowPackages: ["remix", ...PALAMEDES_REMIX_ASSET_PACKAGES],
  sourceMaps: process.env.NODE_ENV === "development" ? "external" : undefined,
  scripts: { loaders: [createPalamedesRemixAssetLoader()] },
});
```

The browser loader transforms ordinary macros after Remix compiles TypeScript
and JavaScript. Remix then rewrites the injected `@palamedes/runtime` import to
an asset URL. The loader does not compile `.po` imports or load Palamedes config;
those remain server-hook responsibilities. A custom `runtimeModule` package
must be added to `allowPackages` in place of the default package constant.

Use the correctly spelled `PALAMEDES_REMIX_ASSET_PACKAGES` export in new code.
The previous `PALEMEDES_REMIX_ASSET_PACKAGES` spelling remains available as a
deprecated alias for compatibility.

### Development source maps and invalidation

Enable Remix `sourceMaps` in development as shown above. The Palamedes loader
returns a map from its generated runtime calls to Remix's compiled JavaScript;
Remix composes that map with its own TypeScript/JSX map and any later import
rewrites or minification. Browser stack traces therefore point to the authored
`.ts`/`.tsx` call site. Transform errors are remapped through the same incoming
map before Remix reports them. Without Remix source maps, the loader can only
report positions in the compiled JavaScript it receives.

Remix's asset watcher owns macro-bearing browser source files. Editing one
invalidates the cached transformed module and re-runs the Palamedes loader; the
normal Remix HMR rules then apply. A module below an accepted HMR boundary is
updated in place, while a change without an accepted boundary intentionally
causes a full browser reload. Neither case requires a server-process restart.
The loader is stateless and safe when Remix invokes it repeatedly for the same
module.

PO catalogs and `palamedes.yaml` are intentionally not dependencies of browser
asset modules: browser transforms contain stable message IDs and source
fallbacks, while the active catalog comes from the document bootstrap. The
server register hook makes imported PO files and the config file dependencies
of the Node module graph. With `node --watch`, changing either restarts the
server, clears the per-locale server/bootstrap caches, and requires a full
document reload so markup and browser messages change atomically. Custom
development runners must provide the equivalent restart. A catalog/config edit
is therefore never expected to hot-swap only an already running browser module.

## Scope

This integration is tested against `remix@3.0.0-rc.1`:

| Area                   | Status                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Server macros          | `t`, `plural`, `select`, and `selectOrdinal` through the Node register hook               |
| Browser macros         | The same ordinary macros through `createPalamedesRemixAssetLoader()`                      |
| Rich Remix UI messages | `Trans`, `Plural`, `Select`, and `SelectOrdinal` in server and browser modules            |
| Client catalog         | Adapter-owned executable ESM asset selected by locale; no function-bearing JSON transport |
| HMR and source maps    | Authored TS/TSX mappings plus Remix watch/HMR invalidation for browser source modules     |
| Remix UI Frames        | Server-rendered document and direct frame requests retain independent request scope       |
| Locale switching       | Cookie, route, subdomain, and TLD through intentional full-document navigation            |
| Public hosting         | Repository example and CI browser proof are ready; a public live deployment is pending    |

Reactive in-document locale replacement is intentionally not supported. A
locale change must create a new document so SSR markup, `<html lang>`, the
bootstrap catalog, and browser runtime always agree.

## Browser Catalog Assets

Configure one adapter-owned catalog registry from the same `palamedes.yaml`
that owns the message catalogs. Pass it to both the browser loader and
`catalogAssets`; this derives selected IDs from each transformed module, so a
lazy module requests only its active-locale fragment. Route registry requests
before the regular Remix asset server. No application catalog map or loader
route is required:

```ts
import {
  createPalamedesRemixAssetLoader,
  createPalamedesRemixCatalogAssetRegistry,
  PALAMEDES_REMIX_ASSET_PACKAGES,
} from "@palamedes/remix";

const catalogAssets = createPalamedesRemixCatalogAssetRegistry({ cwd: import.meta.dirname });
const assetServer = createAssetServer({
  basePath: "/assets",
  allowFiles: ["app/**/public/**"],
  allowPackages: [...PALAMEDES_REMIX_ASSET_PACKAGES],
  scripts: { loaders: [createPalamedesRemixAssetLoader({ catalogAssets })] },
});
// In the request listener, before assetServer.fetch(request):
const fragment = catalogAssets.serve(request);
if (fragment) return fragment;
```

Pass the same `catalogAssets` to `createRemixI18nServer`, render
`renderClientCatalog(locale)` into the document head, and send matching
`/assets/__palamedes/catalog/:locale.js` requests to
`serveClientCatalogAsset(request)` before the normal Remix asset server. The
browser entry loads the executable module before importing translated code:

```ts
import { initializeRemixClientI18nAsync } from "@palamedes/remix/client";

const link = document.querySelector("link[data-palamedes-catalog-locale]");
if (!(link instanceof HTMLLinkElement)) throw new Error("Missing catalog asset link");
await initializeRemixClientI18nAsync({ createI18n, catalogUrl: link.href });
```

The shared registry can also be the server catalog loader. Omit the old
application `loadMessages` function and let `run()` await the executable
catalog for the resolved active locale:

```ts
const catalogAssets = createPalamedesRemixCatalogAssetRegistry({ cwd: import.meta.dirname });
const remixI18n = createRemixI18nServer({
  locales,
  strategy: "cookie",
  catalogAssets: { registry: catalogAssets },
});
```

Server loads are lazy, shared by concurrent requests for the same locale, and
discarded when the config or catalog generation changes. `createI18n(locale)`
remains a synchronous compatibility API and therefore requires an explicit
synchronous `loadMessages`; request handlers should use `run()` with a shared
registry. Applications do not import `.po` files or maintain locale-to-catalog
maps in this mode.

Only the active locale module and selected executable fragments are requested.
Each module exports the locale, content digest, and branded compiled functions;
no catalog functions cross HTML or JSON. Missing assets, locale mismatches,
module evaluation errors, and invalid compiled modules fail before translated
browser modules execute. A failed lazy fragment can be retried after the
network or asset server recovers; registry generations change their URL when a
module's selected IDs change.

## Legacy Browser Catalog Bootstrap

The old JSON bootstrap is an inert migration boundary. It cannot initialize the
parser-free runtime; deliver the generated executable catalog through the Remix
asset pipeline tracked in #1214 before importing translated browser modules:

```ts
// Server setup
export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "cookie",
  loadMessages, // May be an executable server catalog.
  loadClientMessages(locale) {
    return browserCatalogs[locale]; // Legacy string data for migration diagnostics.
  },
});

// While rendering inside remixI18n.run(...)
const catalog = remixI18n.renderClientBootstrap(locale);
```

The legacy `catalog` is an inert `<template id="palamedes-i18n-bootstrap">`, not
an executable inline script. `initializeRemixClientI18n()` rejects it with an
explicit #1214 asset-pipeline diagnostic. In the browser entry, initialize the
executable generated catalog before importing translated modules:

```ts
import { createI18n } from "@palamedes/core";
import { initializeRemixClientI18n } from "@palamedes/remix/client";

initializeRemixClientI18n({ createI18n });
await import("./translated-app.js");
```

The legacy server payload contains inert ICU strings and cannot initialize the
parser-free runtime. `initializeRemixClientI18n()` runs only in a browser
environment, requires an executable generated catalog asset, validates the
payload and exact `<html lang>` match, installs the catalog, and only then
exposes it to transformed browser code. Render `<html lang={locale}>`; if the
attribute is missing, initialization reports that it cannot verify the document
locale. Missing, malformed, inert, executable, or locale-mismatched payloads
fail with an actionable error instead of mixing locales silently. The host
asset-pipeline migration is tracked in #1214.

Locale changes require a full document navigation. A new request resolves the
cookie, route, host, or language header again and emits a matching document and
catalog. There is no browser `.po` request and no separate catalog HTTP cache:
the payload follows the document's cache policy. Vary shared document caches by
the locale inputs they use (for cookie selection, use `Vary: Cookie` or a
private response) and invalidate them when the returned `catalogVersion`
changes. The default version is a stable SHA-256 content digest; a deployment
version can be supplied with `catalogVersion`.

Server and client catalogs are cached per locale for the life of the server
instance. Development watch processes should restart when PO/config inputs
change. The inert template works with a CSP that disallows inline scripts; keep
the bootstrap entry in an allowed external module. Advanced renderers may pass
an already parsed `bootstrap` object or custom `document`/`elementId` to the
client initializer.

## Remix UI, Frames, and Rich Messages

Remix UI Frames are supported on the server. Render both the document and the
frame endpoint inside `remixI18n.run()` so a streamed frame and a later,
client-initiated frame reload independently resolve the same request locale:

```tsx
import { Frame } from "remix/ui";
import { renderToStream } from "remix/ui/server";

function renderDocument(request: Request, locale: string) {
  return renderToStream(
    <html lang={locale}>
      <body>
        <Frame name="locale-summary" src="/frames/locale-summary" fallback={<p>Loading…</p>} />
      </body>
    </html>,
    {
      frameSrc: request.url,
      signal: request.signal,
      resolveFrame: () => renderLocaleSummary(),
    },
  );
}
```

The cookie example exercises both `/frames` and `/frames/locale-summary` with
German translations. Use ordinary JavaScript macros such as `t` inside Remix UI
components; those calls remain visible to the server loader after JSX lowering.

Import rich-message macros from the Remix-specific entry:

```tsx
import { Plural, Select, SelectOrdinal, Trans } from "@palamedes/remix/macro";
import type { Handle } from "remix/ui";

export function Greeting(handle: Handle<{ name: string; count: number }>) {
  return () => (
    <p>
      <Trans>
        Hello <strong>{handle.props.name}</strong>
      </Trans>
      <Plural value={handle.props.count} one="# message" other="# messages" />
    </p>
  );
}
```

The transform rewrites `Trans` to `@palamedes/remix/compiled` and lowers the
choice macros to the active Palamedes runtime. The compiled entry uses Remix
UI elements and component handles directly; it has no React runtime or type
dependency. Named tags preserve the supplied element's props and receive the
translated children. Values may contain Remix elements and nested node arrays.

Both `remix/node-tsx` output and browser asset modules are supported. The
transformer recognizes the `jsx`, `jsxs`, and `jsxDEV` binding identities
emitted by Remix and recovers the same message, placeholders, and tag numbering
as authored TSX. Dynamic lowered trees still fail with a source-oriented
diagnostic because their message identity cannot be determined statically.

## Runtime Cost

Remix v3 intentionally has no build step: `remix/node-tsx` reads and lowers
every `.ts`, `.tsx`, and `.jsx` module through `oxc-transform` when the process
starts, in development and production alike. The Palamedes hook joins that
existing pipeline instead of adding a new one, and Palamedes' native macro
transform is built on the same OXC infrastructure Remix itself uses.

In practice:

- Modules without Palamedes macro imports are skipped after a fast substring
  scan of source that is already in memory.
- Modules with macros run through the native transform once, at module load
  time. Macro call sites are patched in place; files are not re-printed.
- After startup there is no per-request transform work. Requests execute plain
  runtime calls against compiled catalogs — the same code shape the build-time
  integrations (`@palamedes/vite-plugin`, `@palamedes/next-plugin`) produce.

`keepSourceFallbacks` retains its legacy option name and defaults to `false`
here. It only controls diagnostic source metadata in generated calls. Set
`keepSourceFallbacks: true` when deployment skew makes authored source text
useful for diagnostics.
V2 package roots and `compiled` aliases both throw on missing compiled entries;
retained metadata never supplies replacement message output. Valid translation
fallbacks are resolved and compiled at build time.

Loaded Palamedes configuration is cached between catalog imports, but each hit
validates the config file's content digest. Catalog modules also register the
config as a dependency, so under `node --watch`, locale, fallback, or
catalog-path edits restart the process without a manual restart.

The transform cost moves from build time to process start, stays proportional
to the number of macro-containing modules, and recurs per cold start. That is
the same tradeoff Remix makes for its own TypeScript and JSX lowering, so
steady-state request performance matches the build-time integrations.

## Server Runtime Scope

Use `@palamedes/remix/server` to bind translated server code to the active
request and cache compiled catalog modules at module scope:

```ts
import { createRemixI18nServer } from "@palamedes/remix/server"

export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "cookie",
  loadMessages,
})

export default createController(routes, {
  actions: {
    home(context) {
      return remixI18n.run(context, ({ locale }) => context.render(<HomePage locale={locale} />))
    },
  },
})
```

`createRemixI18nRequestScope()` remains available for lower-level integrations.
Both APIs preserve the active i18n scope while a returned `Response.body` is
streamed, so translated code that executes during body consumption still sees
the same request-local i18n instance. Fetch metadata on that response, including
`url`, `type`, and `redirected`, is preserved while the body is wrapped.

`createRemixI18nServer()` also exposes `createClientBootstrap(locale)` and
`renderClientBootstrap(locale)`. Those helpers remain available for validating
legacy transport migrations; they do not turn raw ICU strings into executable
messages. `catalogVersion` accepts a non-empty string or a function of
`{ locale, messages }` and defaults to a deterministic digest.

## Prerelease Tracking

The package peer range is `remix@^3.0.0-rc.1`, while the examples pin the exact
version they prove: currently `remix@3.0.0-rc.1`. A newer prerelease or stable
release is called supported only after all four example manifests are updated
together and the smoke and focused browser lanes pass:

```sh
pnpm verify:examples:smoke -- --framework remix
```

For early warning, maintainers can run the same smoke command after temporarily
overriding the examples to `remix@next`; failures should be treated as a
non-blocking canary signal unless the pinned prerelease also fails.

The repository example is technically ready to become a public demo when the
published examples image contains it, the pinned smoke/browser checks are
green, and an HTTPS deployment passes a reachability check plus locale switch,
hydration, and browser-console verification. Only then should the framework
matrix replace its source link with a live URL; hosting remains managed
separately from this package.

<!-- ferramenta-family:start -->

**palamedes** is part of the [Ferramenta](https://ferramenta.dev) family — Rust-native developer tools that keep the APIs the ecosystem already knows.

Siblings: [ferroni](https://sebastian-software.github.io/ferroni/) · [ferriki](https://github.com/sebastian-software/ferriki) · [ferromark](https://sebastian-software.github.io/ferromark/) · [ferrolex](https://github.com/sebastian-software/ferrolex) · [ferrocat](https://ferrocat.dev) · [ferrovia](https://github.com/sebastian-software/ferrovia) · [ferralk](https://github.com/sebastian-software/ferralk) · [ferrugo](https://github.com/sebastian-software/ferrugo).
<!-- ferramenta-family:end -->

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT OR Apache-2.0 © 2026 Sebastian Software
