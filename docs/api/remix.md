# `@palamedes/remix`

`@palamedes/remix` integrates Palamedes with Remix v3's Node loader and browser
asset pipelines.

```sh
pnpm add @palamedes/core @palamedes/core-node @palamedes/remix @palamedes/runtime remix
```

Install `@palamedes/core` as a direct runtime dependency: generated catalog
modules import `defineCompiledCatalog()` from its `compiled` entrypoint.

It targets Remix v3's default Node loader model rather than Vite. Register
Remix's TSX loader first, then Palamedes:

```sh
node --import remix/node-tsx --import @palamedes/remix/register server.ts
```

Register `remix/node-tsx` first. If the order is reversed, Remix's loader
short-circuits TS/TSX loading before the Palamedes hook can transform macros.

## Exports

- `createPalamedesRemixLoadHook(options?)`
- `createPalamedesRemixAssetLoader(options?)`
- `PALAMEDES_REMIX_ASSET_PACKAGES`
- `@palamedes/remix/register`
- `@palamedes/remix/server`
- `@palamedes/remix/client`
- `@palamedes/remix/macro`
- `@palamedes/remix/compiled`
- `createRemixI18nServer(options)`
- `startRemixClient(loadEntry, options?)`
- `initializeRemixClientI18nAsync(options)`
- `createRemixI18nRequestScope(resolveI18n, options?)`
- `remixI18nContext`
- Types from `@palamedes/remix/server`: `RemixI18nServerOptions`,
  `RemixI18nServer`, `RemixI18nRunInput`, `RemixI18nOptions`,
  `RemixI18nOptionsResolver`, `RemixCatalogAssetConfig`,
  `RemixCatalogAssetOptions`, `RemixI18nContextKey`, `RemixI18nContextReader`,
  `RemixI18nContextValue`, `RemixI18nRequestScopeOptions`, and the
  client-entry and catalog-asset types

## Complete Setup Sequence

The checked [Remix cookie example](../../examples/remix-cookie) is the canonical
full-stack reference. Its setup has six ordered parts:

1. Start Node with
   `node --import remix/node-tsx --import @palamedes/remix/register server.ts`.
2. Add `createPalamedesRemixAssetLoader()` to the asset server's
   `scripts.loaders`, allow `PALAMEDES_REMIX_ASSET_PACKAGES`, and enable Remix
   source maps in development.
3. Create the request-local server with `createRemixI18nServer()`, loading the
   generated executable catalog for the selected locale.
4. Render the document and any Remix Frame endpoints inside
   `remixI18n.run()` or its middleware.
5. Share one catalog asset registry between the server scope and browser asset
   loader. Serve its generated modules through the asset namespace and render
   the adapter's client entry. It loads active-locale fragments before translated
   browser modules execute; application code does not initialize catalog loading.
6. Import ordinary macros from `@palamedes/core/macro` and rich Remix macros
   from `@palamedes/remix/macro` in both server and browser source.

Locale controls must perform a full document navigation. This is a deliberate
part of the contract, not a missing client API: the next request resolves one
locale and emits matching SSR markup, document language, bootstrap catalog,
and browser runtime.

## Register Options

```ts
interface PalamedesRemixRegisterOptions {
  include?: string | RegExp | Array<string | RegExp> | null;
  exclude?: string | RegExp | Array<string | RegExp> | null;
  projectRoot?: string;
  runtimeModule?: string;
  includeSourceMetadata?: boolean;
  configPath?: string;
  failOnMissing?: boolean;
}
```

Defaults:

- `include`: `/\.(tsx?|jsx?|mjs|mts)$/`
- `exclude`: `/[/\\]node_modules[/\\]/`
- `runtimeModule`: `"@palamedes/runtime"`
- `includeSourceMetadata`: `false`
- `projectRoot`: the current working directory
- `configPath`: unset — `.po` imports discover the Palamedes config upward from
  the imported catalog file's directory. A relative `configPath` resolves from
  `projectRoot`; an absolute one stays absolute
- `failOnMissing`: `false` — missing translations warn instead of failing
  `.po` compilation

`include` and `exclude` accept a glob string, a RegExp, or an array of both,
with the same matching as the [Vite plugin](./vite-plugin.md#paths-and-filters):
relative globs resolve from `projectRoot`, and RegExps test the absolute file
path. `exclude` also skips matching `.po` and `.fcl` imports.

Invalid and unsupported ICU always fails `.po` compilation. The load hook throws
a migration error when it receives the removed v1 `failOnCompileError` or
`keepSourceFallbacks` option; `keepSourceFallbacks` is now
`includeSourceMetadata`. See the
[v2 migration guide](../migration-v2.md#replace-removed-apis).

The default intentionally excludes `.cjs` and `.cts` because the macro
transform injects ESM imports. Pass a custom `include` only if your hook also
provides a CommonJS-compatible runtime binding.

Vite and Next use the shared bundler default from `@palamedes/transform`, which
also includes `.cjs` and `.cts`. Remix keeps this narrower loader-only
exception because Node executes those load results as CommonJS rather than
passing them through a bundler. ESM-typed `.mts` files use the Remix default.

Macro calls use the plain, framework-neutral getter; locale changes require
document navigation.

`includeSourceMetadata` defaults to `false` in every environment. Set
`includeSourceMetadata: true` to retain authored text as diagnostic metadata.
Missing compiled messages always throw; metadata never supplies replacement
output.

`.po` imports are claimed by the hook before Node's default loader runs. They
compile through the same catalog module path used by the Vite/Next integrations
and require a Palamedes config (`palamedes.yaml`, `palamedes.config.ts`, etc.).
The hook caches loaded config objects while validating the config file's content
digest on every cache hit, so `node --watch` processes observe config edits
without a manual restart.

## Browser Assets

Remix compiles TypeScript and JavaScript before calling `scripts.loaders`.
Install the Palamedes asset loader there so ordinary macros are transformed
before Remix analyzes imports, HMR boundaries, and minification:

```ts
import {
  createPalamedesRemixAssetLoader,
  createPalamedesRemixCatalogAssetRegistry,
  PALAMEDES_REMIX_ASSET_PACKAGES,
} from "@palamedes/remix";
import { createAssetServer } from "remix/assets";

const registry = createPalamedesRemixCatalogAssetRegistry();
export const assetServer = createAssetServer({
  basePath: "/assets",
  allowFiles: ["app/routes.ts", "app/**/public/**"],
  allowPackages: ["remix", ...PALAMEDES_REMIX_ASSET_PACKAGES],
  sourceMaps: process.env.NODE_ENV === "development" ? "external" : undefined,
  scripts: {
    loaders: [createPalamedesRemixAssetLoader({ catalogAssets: registry })],
  },
});
```

`PALAMEDES_REMIX_ASSET_PACKAGES` contains `@palamedes/core`,
`@palamedes/runtime`, and `@palamedes/remix`. They must be in `allowPackages`
because transformed modules import `getI18n()` for ordinary macros and the
Remix compiled component for rich messages. Remix rewrites those package
imports to served asset URLs. If `runtimeModule` selects another package, allow
that exact package name instead of `@palamedes/runtime`.

`PalamedesRemixAssetLoaderOptions` exposes the shared `include`, `exclude`,
`projectRoot`, `runtimeModule`, and `includeSourceMetadata` options. Defaults match the Node
loader, and the asset loader rejects `keepSourceFallbacks` with the same
migration error. Transform failures identify the source module and retain the
original error as their cause.

The browser loader transforms script source and registers its compiled message IDs
with the shared catalog registry. Native compilation remains on the server;
no `.po` file or ICU parser is sent to the browser.

With source maps enabled, Remix composes the Palamedes transform map with its
TS/JSX compilation map, later import rewrites, and production minification.
Browser traces and transform diagnostics therefore resolve to authored
TypeScript/TSX positions. Remix's watcher invalidates edited macro-bearing
browser modules and applies its normal HMR policy: accepted boundaries update
in place and other changes reload the document, without restarting the server.

`createPalamedesRemixCatalogAssetRegistry(options?)` accepts `projectRoot`
(default: the current working directory), `configPath`, `basePath` (default
`"/assets"`), and `watch`. It searches for the config upward from
`projectRoot`, and a relative `configPath` resolves from `projectRoot`. The
removed `cwd` option throws a migration error; rename it to `projectRoot`.

Fragment URLs identify an authored module relative to the configuration root and
its compiled message IDs. A cold or restarted worker reconstructs that selection
from its own source files, so equivalent deployments can use different absolute
checkout paths. Workers need the same source tree, catalogs, and configuration;
no earlier document or asset request is required on that worker. Configured
catalog includes and excludes also apply to reconstruction, including explicit
sibling workspace includes, together with the `include` and `exclude` options of
asset loaders that use the registry. A source identity must use the exact
on-disk spelling, so case-variant and symlink aliases are rejected. Modules
without messages never receive fragment URLs and answer 404. Requests never
supply message IDs or executable source.

Keep authored source files available with the Remix asset server. Custom loaders
must preserve the authored message IDs: adding or removing messages during
post-compilation fails registration with a diagnostic. The registry compiles
only the verified module selection for the requested supported locale. A stale
selection returns 404 after source invalidation; catalog-only edits retain URLs.

The catalog registry watches PO/FCL and config inputs in development and clears
compiled caches without changing registered module URLs. Warm requests do not
scan these files. Other runners can enable `watch: true` or explicitly call
`registry.invalidate()`. Reload the document after catalog changes to keep SSR
and browser messages on the same generation. Direct catalog imports through the
Node register hook follow the host's module-graph restart policy.

## Server Request Scope

```ts
import { createPalamedesRemixCatalogAssetRegistry } from "@palamedes/remix";
import { defineLocaleControls } from "@palamedes/core/locale";
import { createRemixI18nServer } from "@palamedes/remix/server";

const locales = defineLocaleControls({
  locales: ["en", "de"],
  defaultLocale: "en",
  cookies: { locale: "locale" },
});

const registry = createPalamedesRemixCatalogAssetRegistry();

export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "cookie",
  catalogAssets: { registry },
});
```

Use `remixI18n.run(context, callback)` inside Remix actions, or install
`remixI18n.middleware()` on a fetch-router. `run()` accepts a Fetch `Request`
or a Remix `RequestContext` (any `RemixI18nRunInput`). The helper resolves the
active locale, creates and activates a Palamedes i18n instance, caches catalog
messages by locale at module scope, and preserves that request-local instance
while a returned `Response.body` is streamed. Wrapping the body also preserves
the response's `url`, `type`, and `redirected` fetch metadata.

When the locale, `i18nOptions`, or catalog cannot be resolved, `run()` and the
middleware throw an error whose message is `failureMessage` (default:
`Palamedes Remix i18n initialization failed before the handler ran.`) and whose
`cause` is the original error. The callback does not run.

When the shared `catalogAssets.registry` is provided, `loadMessages` is
optional. `run()` then loads the complete executable catalog for the resolved
active locale on first demand, shares concurrent loads, and drops them when
the config or catalog generation changes. This mode keeps `.po` imports and
locale-to-catalog maps inside the adapter.

Supported strategies are `cookie`, `route`, `subdomain`, and `tld`. Route
strategy reads `context.params.locale` by default; when that param is absent,
it falls back to the request URL's first path segment. Pass `routeParam` to use
a different param name. Cookie serialization is available through
`remixI18n.serializeLocaleCookie(locale)`.

Further `createRemixI18nServer` options: `i18nOptions` (the request-local
`createI18n` options such as `timeZone`, or `(request, locale) => options`),
`failureMessage`, `cookieName` (default `"locale"`), and `cookieMaxAge`
(default one year, in seconds). `catalogAssets` accepts a
`RemixCatalogAssetConfig` (the resolved catalog configuration) and a
locale-to-`.po` resolver. For browser graph splitting, pass
one `createPalamedesRemixCatalogAssetRegistry()` result to both the browser
asset loader and `catalogAssets`; the loader registers each module's actual
compiled IDs, so no hand-maintained catalog map is needed. The adapter exposes
`createClientCatalogAsset(locale)`, `renderClientCatalog(locale)`, and
`serveClientCatalogAsset(request)` for executable ESM delivery. `catalogVersion`
overrides the default deterministic content digest with a deployment version
string. The v1 callback form is removed and throws a migration error.

For matching date and time formatting during hydration, pass
`i18nOptions: { timeZone: "Europe/Berlin" }` to the server and render
`data-palamedes-time-zone="Europe/Berlin"` on the document's `<html>` element.
The adapter-owned browser entry reads that IANA time zone before translated
modules execute. Omitting the attribute preserves the runtime's default time
zone behavior.

Besides `run()`, `middleware()`, and `serializeLocaleCookie()`, the server
object exposes `resolveLocale(input)` for standalone locale resolution and
`get(context?)` — the read accessor for the active request scope, which is how
handlers running under `middleware()` reach the current i18n instance. Pass the
Remix `RequestContext` (a `RemixI18nContextReader`) to read the value stored
under `remixI18nContext`, whose type is `RemixI18nContextKey`. The v1
synchronous `createI18n(locale)` method is removed; create request instances
through `run()` or the middleware.

`renderClientEntry()` takes the request's CSP nonce as a string. The
application calls it while rendering each document, so it already has the
request; a resolver function would add nothing.

## Client Catalog Assets

Create one `createPalamedesRemixCatalogAssetRegistry()` and pass it to both
`createPalamedesRemixAssetLoader({ catalogAssets: registry })` and
`createRemixI18nServer({ locales, strategy, catalogAssets: { registry } })`.
The registry loads every configured server catalog lazily in declaration order. Native output is written as ordinary ESM in a process-local temporary directory and imported by Node, without `eval`, `Function`, or `vm` execution. Identical output shares the same module URL; Node retains evaluated modules for the process lifetime, including superseded development generations.
Concurrent requests share the immutable locale snapshot; each request receives
its own locale, formatter settings, callbacks and overrides.

Serve `registry.serve(request)` and `remixI18n.serveClientCatalogAsset(request)`
before `assetServer.fetch(request)` under the asset namespace. Render the
adapter's catalog link and application entry in the document:

```ts
const clientCatalog = remixI18n.renderClientCatalog(locale);
const clientEntry = await remixI18n.renderClientEntry("app/public/client.tsx", { assetServer });
```

Every server worker can serve the external bootstrap immediately, including
before it renders its first document. The entry URL and optional error markup
travel in the nonce-protected import map, scoped to the bootstrap's own URL, so
injected page markup cannot redirect the entry or replace the error UI. Serving
the bootstrap does not require per-worker entry registration. Workers must use
the same application build and asset mounts.

`renderClientEntry()` is asynchronous and accepts an entry file path plus the
same `assetServer` used for browser delivery. It renders the import map for the
application and adapter bootstrap, then an external module script. The adapter
initializes the document locale, awaits its catalog and imports the application
entry.
Application code does not query catalog links, build loader maps or handle
catalog readiness. The asset loader selects each module's actual message IDs
and awaits the active locale's fragment before evaluating that module. Modules
loaded after interaction request only their additional fragments.

Initial and lazy catalog network or evaluation failures reach a catalog-independent
error page with Reload and Home actions. `renderClientEntry(entry, { assetServer, errorHtml,
nonce })` accepts trusted ordinary host error markup and an optional CSP nonce.
A custom Reload button uses `data-palamedes-reload`. The external bootstrap
and inline import map work with `script-src 'self' 'nonce-…'`; pass the request
nonce to cover both scripts, without `unsafe-inline` or `unsafe-eval`.
Entry and bootstrap URLs come from the asset server, including custom mounts
and fingerprints. The former `catalogAssets.clientModuleUrl` override is
rejected: relocating a module URL without its import-map scope breaks bare
dependency resolution. Configure the actual asset server's mounts instead.

The lower-level `initializeRemixClientI18nAsync()` and `startRemixClient()` are
available for custom host integrations. Generated executable catalogs never
cross JSON. Do not brand raw ICU maps with `defineCompiledCatalog()`; it validates native
generated constants and functions and does not compile ICU.

The browser requests only the document locale. Locale changes perform a full
document navigation so `<html lang>` and the executable catalog agree. Vary
HTML caching by the inputs used to choose the locale. Catalog generation is
stable on warm server requests: no config or PO scan happens per request.
`registry.invalidate()` refreshes config and catalogs explicitly and invalidates
the shared store. Development and Node `--watch` processes watch these inputs
automatically; `watch: true` enables this for another runner. Fragment URLs
remain valid for cached transformed modules, while their ETags and content change.
Reload affected documents to install a new generation. Close the registry with
`registry.close()` when the host shuts down.

## Support Matrix

| Area                | Support contract                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| Server macros       | Ordinary macros transformed after `remix/node-tsx`                                              |
| Browser macros      | Ordinary macros transformed by the post-compile asset loader                                    |
| Rich Remix messages | `Trans`, `Plural`, `Select`, and `SelectOrdinal` in server and browser modules                  |
| Request scope       | Fetch requests and streamed responses through `createRemixI18nServer()`                         |
| Client catalog      | Adapter-owned executable fragments for the active document locale; inert ICU bootstrap rejected |
| HMR and source maps | Source edits invalidate through Remix; composed authored TS/TSX maps and diagnostics            |
| Remix Frames        | Document render and direct frame reload retain their own request-local locale                   |
| Locale strategies   | Cookie, route, subdomain, TLD, and `Accept-Language`; switching reloads the document            |
| Public hosting      | Live cookie, route, subdomain, and TLD demos, verified in Chromium over HTTPS                   |

Reactive same-document locale replacement, browser `.po` loading, and an Edge
or Worker server runtime are non-goals for the current Node integration. The
browser transform compiles call sites to the same active runtime installed by
the document bootstrap.

## Runtime Cost

Remix v3 runs its loader hooks in development and production alike; there is no
build step. The Palamedes hook joins that pipeline: modules without macro
imports are skipped after a substring scan, macro-containing modules are patched
once at module load time by the native OXC-based transform, and requests execute
plain runtime calls with no per-request transform work. The cost moves from
build time to process start and recurs per cold start — the same tradeoff Remix
makes for its own TypeScript and JSX lowering via `oxc-transform`.

## Remix Frames and Rich Messages

Server-rendered Remix Frames are supported. Put the full document and the
endpoint used by each `<Frame>` inside `remixI18n.run()` (or middleware) so the
initial stream and direct frame reload each establish request-local i18n state.
The `remix-cookie` smoke test requests both `/frames` and
`/frames/locale-summary` with a German locale and verifies the same translated
frame content.

Ordinary JavaScript macros, including `t`, remain supported in Remix
components because they survive Remix's JSX lowering. The native transformer
also recognizes the binding identities imported from `remix/component/jsx-runtime`
and `remix/component/jsx-dev-runtime`; it can recover the static `Trans`, `Plural`,
`Select`, and `SelectOrdinal` structure and produce the same message identity as
authored TSX.

Use `Trans`, `Plural`, `Select`, and `SelectOrdinal` from
`@palamedes/remix/macro`. The transform targets
`@palamedes/remix/compiled`, whose `Trans` component produces branded Remix
nodes without a React dependency. Its props require the compiled `id` that the
transform injects; `message` is diagnostic metadata only. Named tag placeholders preserve the supplied
Remix element's props while replacing its authored children with translated
children. Primitive placeholders, Remix elements, and nested node arrays are
supported. Missing entries and execution failures propagate to ordinary host error handling; no source text or internal ID substitutes for the failed message.

The macro types use Remix component handles and reject React-only element
shapes. Dynamic lowered trees and prop spreads are rejected with a source
diagnostic instead of being left as live macro calls.

## Migration From The Experimental Cookie Example

The earlier Remix cookie example kept demo catalogs inline and wired i18n
manually in the example controller. Move those pieces to the full-stack setup:

1. Add `palamedes.yaml` and checked-in `.po` catalog files.
2. Share a generated catalog asset registry between the browser asset loader
   and `createRemixI18nServer({ catalogAssets: { registry } })`.
3. Replace per-route manual locale activation with `remixI18n.run(context, ...)`
   or `remixI18n.middleware()`.
4. Keep the Node command order as
   `node --import remix/node-tsx --import @palamedes/remix/register server.ts`.
5. Render `renderClientCatalog(locale)` and `await renderClientEntry(entryPath, { assetServer })`;
   route the adapter asset handlers before the regular Remix asset server.

## Tested Remix Version

The peer range is `remix@^3.0.0`; all four examples pin the stable baseline
`remix@3.0.0`. RC.1 and earlier prereleases are no longer supported. Update
`remix/ui` imports (including `/server`, `/test`, and JSX runtimes) and
`jsxImportSource` to `remix/component`. Component HMR users must also rename
`remix/ui-hmr` to `remix/component-hmr` and `uiHmr()` to `componentHmr()`.
The integration uses no APIs from the separately versioned `@remix-run/ui`.

When changing the stable baseline, move all four example manifests together
and run `pnpm verify:examples:smoke -- --framework remix` and
`pnpm verify:examples:browser -- --framework remix`. A `remix@next` canary is
non-blocking and does not expand support to prereleases.

## Public Demos

All four strategies run as public demos; the
[demo deployments](../demo-deployments.md#remix) list their URLs. Hosting is
managed separately from this package. A hosted deployment counts as verified
when these conditions hold:

- the published examples image contains the pinned Remix example;
- the smoke matrix and all four Remix Chromium checks are green;
- the deployment is reachable over its final HTTPS hostname;
- locale navigation produces matching SSR, `<html lang>`, and bootstrap data;
- hydration, interaction, Frames, and browser-console checks pass against that
  deployment.

## Four-Strategy Browser Verification

All four examples pin stable `remix@3.0.0` and use the same server-rendered
interactive island, browser asset loader, executable catalog fragments, and
rich-message runtime. Cookie, route, and subdomain cover English, German, and
Spanish; TLD also covers French. Chromium verifies initial rendering,
interaction, full-document locale switches, direct reloads, document and
standalone Frame responses, and initial/lazy catalog failure recovery under CSP.
The examples send their own `Content-Security-Policy` header with a fresh nonce
for each document, applied to the import map and external bootstrap.
Route Frame URLs retain the locale prefix (`/de/frames` and
`/de/frames/locale-summary`); host strategies retain the locale host.

`node scripts/verify-hosted-examples.mjs remix-cookie remix-route remix-subdomain remix-tld`
runs the same Chromium checks against the public deployments. See the
[deployment guide](../demo-deployments.md) for the image, routing, DNS, TLS,
and caching gates.
