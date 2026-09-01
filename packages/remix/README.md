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
import { createPalamedesRemixAssetLoader, PALEMEDES_REMIX_ASSET_PACKAGES } from "@palamedes/remix"
import { createAssetServer } from "remix/assets"

const assetServer = createAssetServer({
  basePath: "/assets",
  allowFiles: ["app/routes.ts", "app/**/public/**"],
  allowPackages: ["remix", ...PALEMEDES_REMIX_ASSET_PACKAGES],
  sourceMaps: process.env.NODE_ENV === "development" ? "external" : undefined,
  scripts: { loaders: [createPalamedesRemixAssetLoader()] },
})
```

The browser loader transforms ordinary macros after Remix compiles TypeScript
and JavaScript. Remix then rewrites the injected `@palamedes/runtime` import to
an asset URL. The loader does not compile `.po` imports or load Palamedes config;
those remain server-hook responsibilities. A custom `runtimeModule` package
must be added to `allowPackages` in place of the default package constant.

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

| Area                   | Status                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------- |
| Server macros          | `t`, `plural`, `select`, and `selectOrdinal` through the Node register hook            |
| Browser macros         | The same ordinary macros through `createPalamedesRemixAssetLoader()`                   |
| Rich Remix UI messages | `Trans`, `Plural`, `Select`, and `SelectOrdinal` in server and browser modules         |
| Client catalog         | Serializable ICU strings embedded in the inert document bootstrap; no browser `.po`    |
| HMR and source maps    | Authored TS/TSX mappings plus Remix watch/HMR invalidation for browser source modules  |
| Remix UI Frames        | Server-rendered document and direct frame requests retain independent request scope    |
| Locale switching       | Cookie, route, subdomain, and TLD through intentional full-document navigation         |
| Public hosting         | Repository example and CI browser proof are ready; a public live deployment is pending |

Reactive in-document locale replacement is intentionally not supported. A
locale change must create a new document so SSR markup, `<html lang>`, the
bootstrap catalog, and browser runtime always agree.

## Browser Catalog Bootstrap

Deliver the server-selected locale and its serializable ICU string catalog in
the document, then initialize Palamedes before importing or rendering translated
browser modules:

```ts
// Server setup
export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "cookie",
  loadMessages, // May be an executable server catalog.
  loadClientMessages(locale) {
    return browserCatalogs[locale] // Serializable Record<string, string>.
  },
})

// While rendering inside remixI18n.run(...)
const catalog = remixI18n.renderClientBootstrap(locale)
```

Place `catalog` inside the rendered `<body>` before the external browser entry.
It is an inert `<template id="palamedes-i18n-bootstrap">`, not executable
inline script. In the browser entry:

```ts
import { createI18n } from "@palamedes/core"
import { initializeRemixClientI18n } from "@palamedes/remix/client"

initializeRemixClientI18n({ createI18n })
await import("./translated-app.js")
```

The server payload uses ICU strings deliberately. Produce them at build or
server startup with `compileCatalogArtifact(...).messages` from
`@palamedes/core-node`; do not serialize executable `.po` module exports.
`initializeRemixClientI18n()` uses the parser-capable `@palamedes/core`
runtime, validates the payload and exact `<html lang>` match, installs the
catalog, and only then exposes it to transformed browser code. Missing,
malformed, executable, or locale-mismatched payloads fail with an actionable
error instead of mixing locales silently.

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
import { Frame } from "remix/ui"
import { renderToStream } from "remix/ui/server"

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
    }
  )
}
```

The cookie example exercises both `/frames` and `/frames/locale-summary` with
German translations. Use ordinary JavaScript macros such as `t` inside Remix UI
components; those calls remain visible to the server loader after JSX lowering.

Import rich-message macros from the Remix-specific entry:

```tsx
import { Plural, Select, SelectOrdinal, Trans } from "@palamedes/remix/macro"
import type { Handle } from "remix/ui"

export function Greeting(handle: Handle<{ name: string; count: number }>) {
  return () => (
    <p>
      <Trans>
        Hello <strong>{handle.props.name}</strong>
      </Trans>
      <Plural value={handle.props.count} one="# message" other="# messages" />
    </p>
  )
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

The register hook preserves source-message fallbacks in both development and
production, so deploy skew renders readable source text rather than a compiled
hash. Create a custom hook with
`createPalamedesRemixLoadHook({ keepSourceFallbacks: false })` to opt into
smaller hash-only output when source text must not ship. Parser-free runtimes
leave retained ICU fallbacks raw; use `@palamedes/core` when they must format.

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
the same request-local i18n instance.

`createRemixI18nServer()` also exposes `createClientBootstrap(locale)` and
`renderClientBootstrap(locale)`. Pass `loadClientMessages` when the server's
`loadMessages` returns executable compiled catalogs; otherwise the existing
serializable catalog is reused. `catalogVersion` accepts a non-empty string or
a function of `{ locale, messages }` and defaults to a deterministic digest.

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

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
