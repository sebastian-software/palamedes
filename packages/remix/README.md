# @palamedes/remix

Remix v3 server and browser asset integration for Palamedes.

Server catalogs load lazily and are shared across isolated requests. Browser
modules await only their own active-locale fragments. Share a
`createPalamedesRemixCatalogAssetRegistry()` between the asset loader and
`createRemixI18nServer({ catalogAssets: { registry } })`, then render
`renderClientCatalog(locale)` and `await renderClientEntry(entryPath, { assetServer })` in the document.
The adapter owns startup and catalog failure recovery; applications choose the
locale and may supply ordinary error markup. See [the Remix API guide](../../docs/api/remix.md#client-catalog-assets).

## Installation

```sh
pnpm add @palamedes/core @palamedes/core-node @palamedes/remix @palamedes/runtime remix
```

`@palamedes/core` must be a direct runtime dependency because generated catalog
modules import `defineCompiledCatalog()` from its `compiled` entrypoint.
`@palamedes/core-node` performs native catalog compilation on the server.

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
import {
  createPalamedesRemixAssetLoader,
  createPalamedesRemixCatalogAssetRegistry,
  PALAMEDES_REMIX_ASSET_PACKAGES,
} from "@palamedes/remix";
import { createAssetServer } from "remix/assets";

const registry = createPalamedesRemixCatalogAssetRegistry();
const assetServer = createAssetServer({
  basePath: "/assets",
  allowFiles: ["app/routes.ts", "app/**/public/**"],
  allowPackages: ["remix", ...PALAMEDES_REMIX_ASSET_PACKAGES],
  sourceMaps: process.env.NODE_ENV === "development" ? "external" : undefined,
  scripts: { loaders: [createPalamedesRemixAssetLoader({ catalogAssets: registry })] },
});
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

The catalog registry watches PO/FCL and configuration inputs in development,
invalidates compiled server and browser caches, and keeps registered module URLs
stable. Warm requests do not scan these inputs. Custom runners can enable
`watch: true` or call `registry.invalidate()` explicitly. Reload the document
after a catalog change so server markup and browser messages use one generation.
Direct catalog imports through the Node register hook remain Node module-graph
dependencies and follow the host's normal restart policy.

## Scope

This integration is tested against `remix@3.0.0`:

| Area                | Status                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------- |
| Server macros       | `t`, `plural`, `select`, and `selectOrdinal` through the Node register hook               |
| Browser macros      | The same ordinary macros through `createPalamedesRemixAssetLoader()`                      |
| Rich Remix messages | `Trans`, `Plural`, `Select`, and `SelectOrdinal` in server and browser modules            |
| Client catalog      | Adapter-owned executable ESM asset selected by locale; no function-bearing JSON transport |
| HMR and source maps | Authored TS/TSX mappings plus Remix watch/HMR invalidation for browser source modules     |
| Remix Frames        | Server-rendered document and direct frame requests retain independent request scope       |
| Locale switching    | Cookie, route, subdomain, and TLD through intentional full-document navigation            |
| Public hosting      | Live cookie, route, subdomain, and TLD demos, verified in Chromium over HTTPS             |

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

const catalogAssets = createPalamedesRemixCatalogAssetRegistry({
  projectRoot: import.meta.dirname,
});
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

Fragment requests also work on cold or restarted workers. The registry resolves
a configuration-relative source identity and verifies its compiled message
selection locally; equivalent deployments can use different checkout paths.
Deploy the same authored source files, catalogs, and configuration to each
worker. Catalog include/exclude rules and the asset loader's `include`/`exclude`
options still apply, and only the requested locale's selected messages are
delivered. Custom loaders must preserve authored message IDs; adding or removing
messages after source compilation produces a registration error. No request supplies executable source or a message-ID list.

Pass the same `catalogAssets` to `createRemixI18nServer`, render
`renderClientCatalog(locale)` into the document head, and send matching
`/assets/__palamedes/catalog/:locale.js` requests to
`serveClientCatalogAsset(request)` before the normal Remix asset server. The adapter starts the application after its document catalog is ready:

```ts
const entry = await remixI18n.renderClientEntry("app/public/client.tsx", { assetServer });
```

The adapter renders the stable Remix import map for both the entry and its own
bootstrap, followed by an external script. It also delivers ordinary
catalog-independent error UI and Reload recovery. Applications do not query internal catalog links.
Configure custom mounts on the actual asset server. The former
`catalogAssets.clientModuleUrl` override is rejected because stable Remix must
resolve the bootstrap URL and its dependency import-map scopes together.

The shared registry can also be the server catalog loader. Omit the old
application `loadMessages` function and let `run()` await the executable
catalog for the resolved active locale:

```ts
const catalogAssets = createPalamedesRemixCatalogAssetRegistry({
  projectRoot: import.meta.dirname,
});
const remixI18n = createRemixI18nServer({
  locales,
  strategy: "cookie",
  catalogAssets: { registry: catalogAssets },
});
```

Server loads are lazy, shared by concurrent requests for the same locale, and
discarded when the config or catalog generation changes. Request handlers use
`run()` or the middleware with a shared registry. Applications do not import
`.po` files or maintain locale-to-catalog maps in this mode.

Only the active locale module and selected executable fragments are requested.
Each module exports the locale, content digest, and branded compiled functions;
no catalog functions cross HTML or JSON. Missing assets, locale mismatches,
module evaluation errors, and invalid compiled modules fail before translated
browser modules execute. A failed lazy fragment can be retried after the
network or asset server recovers; registry generations change their URL when a
module's selected IDs change.

## Migration From Inert Catalogs

Palamedes 2.0 removed the 1.x JSON bootstrap, which could not carry executable
compiled functions: `loadClientMessages`, `createClientBootstrap()`,
`renderClientBootstrap()`, `readRemixI18nBootstrap()`, the synchronous
`initializeRemixClientI18n()`, and `REMIX_I18N_BOOTSTRAP_ID` no longer exist.
Remove application catalog maps and manual client initialization. Use the
shared registry and `renderClientEntry()` described above. No ICU strings are serialized into HTML.
Locale changes reload the document; vary its cache policy by locale inputs.

Catalog/config inputs are watched in development and Node `--watch` processes.
Custom runners can enable `watch: true` or call `registry.invalidate()`.
Catalog edits preserve fragment URLs referenced by cached modules, update ETags
and invalidate server snapshots. Reload the document to activate new contents.
Use `registry.close()` during shutdown. Registry-backed catalog versions are
content-derived; legacy message callbacks are rejected. A deployment version
string remains available as an explicit override.

## Remix Components, Frames, and Rich Messages

Remix Frames are supported on the server. Render both the document and the
frame endpoint inside `remixI18n.run()` so a streamed frame and a later,
client-initiated frame reload independently resolve the same request locale:

```tsx
import { Frame } from "remix/component";
import { renderToStream } from "remix/component/server";

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
German translations. Use ordinary JavaScript macros such as `t` inside Remix
components; those calls remain visible to the server loader after JSX lowering.

Import rich-message macros from the Remix-specific entry:

```tsx
import { Plural, Select, SelectOrdinal, Trans } from "@palamedes/remix/macro";
import type { Handle } from "remix/component";

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

`includeSourceMetadata` defaults to `false` here. It only controls diagnostic
source metadata in generated calls. Set `includeSourceMetadata: true` when
deployment skew makes authored source text useful for diagnostics. The removed
v1 options `keepSourceFallbacks` and `failOnCompileError` throw a migration
error.
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

Pass `i18nOptions` for request-local formatting options such as
`{ timeZone: "Europe/Berlin" }`, or a `(request, locale) => options` function.
When the locale, options, or catalog cannot be resolved, `run()` throws an error
with `failureMessage` (default `Palamedes Remix i18n initialization failed
before the handler ran.`) and the original error as its `cause`.

`createRemixI18nRequestScope(resolveI18n, { failureMessage })` remains available
for lower-level integrations.
Both APIs preserve the active i18n scope while a returned `Response.body` is
streamed, so translated code that executes during body consumption still sees
the same request-local i18n instance. Fetch metadata on that response, including
`url`, `type`, and `redirected`, is preserved while the body is wrapped.

`catalogVersion` on `createRemixI18nServer()` overrides the version of
executable client catalog assets with a non-empty deployment string; it
defaults to a digest of the delivered module. The v1 callback form throws a
migration error.

## Stable Version Support

The package peer range is `remix@^3.0.0`, while all four examples pin the
stable baseline `remix@3.0.0`. RC.1 and earlier prereleases are no longer
supported: they expose the component runtime under the removed `remix/ui`
paths. Update component, server, test, and JSX imports to `remix/component`
and set `jsxImportSource` to `remix/component`. If an application uses component
HMR, rename `remix/ui-hmr` to `remix/component-hmr` and `uiHmr()` to
`componentHmr()`. The adapter does not require the separately versioned
`@remix-run/ui` primitives package.

Run both integration checks when changing the pinned stable baseline:

```sh
pnpm verify:examples:smoke -- --framework remix
pnpm verify:examples:browser -- --framework remix
```

A `remix@next` run is a non-blocking canary and does not expand the supported
peer range to prereleases.

All four strategies run as public demos. Hosting is managed separately from
this package; the [demo deployments](../../docs/demo-deployments.md#remix) list
their URLs.

<!-- ferramenta-family:start -->

**palamedes** is part of the [Ferramenta](https://ferramenta.dev) family — A family of Rust tools.

Siblings: [ferroni](https://sebastian-software.github.io/ferroni/) — Oniguruma-compatible regex engine · [ferriki](https://github.com/sebastian-software/ferriki) — Shiki-compatible syntax highlighting · [ferromark](https://sebastian-software.github.io/ferromark/) — Markdown to HTML with a secure default and every GFM extension included. · [ferrolex](https://github.com/sebastian-software/ferrolex) — Spell checking for text and code · [ferrocat](https://ferrocat.dev) — Translation catalog engine · [ferrovia](https://github.com/sebastian-software/ferrovia) — SVGO-compatible SVG optimizer · [ferralk](https://github.com/sebastian-software/ferralk) — Glob matching and parallel filesystem walking · [ferrugo](https://github.com/sebastian-software/ferrugo) — PDF previews for untrusted files.
<!-- ferramenta-family:end -->

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT OR Apache-2.0 © 2026 Sebastian Software

## Four-Strategy Browser Verification

All four examples pin stable `remix@3.0.0` and use the same server-rendered
interactive island, browser asset loader, executable catalog fragments, and
rich-message runtime. Cookie, route, and subdomain cover English, German, and
Spanish; TLD also covers French. Chromium verifies initial rendering,
interaction, full-document locale switches, direct reloads, document and
standalone Frame responses, and initial/lazy catalog failure recovery under CSP.
Route Frame URLs retain the locale prefix (`/de/frames` and
`/de/frames/locale-summary`); host strategies retain the locale host.

`node scripts/verify-hosted-examples.mjs remix-cookie remix-route remix-subdomain remix-tld`
runs the same Chromium checks against the public deployments. The
[demo deployments](../../docs/demo-deployments.md#remix) list their URLs.
