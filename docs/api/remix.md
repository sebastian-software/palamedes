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
- `PALEMEDES_REMIX_ASSET_PACKAGES`
- `@palamedes/remix/register`
- `@palamedes/remix/server`
- `@palamedes/remix/client`
- `@palamedes/remix/macro`
- `@palamedes/remix/compiled`
- `createRemixI18nServer(options)`
- `initializeRemixClientI18n(options)`
- `readRemixI18nBootstrap(options?)`
- `REMIX_I18N_BOOTSTRAP_ID`
- `createRemixI18nRequestScope(resolveI18n)`
- `remixI18nContext`

## Complete Setup Sequence

The checked [Remix cookie example](../../examples/remix-cookie) is the canonical
full-stack reference. Its setup has six ordered parts:

1. Start Node with
   `node --import remix/node-tsx --import @palamedes/remix/register server.ts`.
2. Add `createPalamedesRemixAssetLoader()` to the asset server's
   `scripts.loaders`, allow `PALEMEDES_REMIX_ASSET_PACKAGES`, and enable Remix
   source maps in development.
3. Create the request-local server with `createRemixI18nServer()`, loading the
   executable server catalog and serializable client ICU strings for the same
   locale.
4. Render the document and any Remix UI Frame endpoints inside
   `remixI18n.run()` or its middleware.
5. Insert `renderClientBootstrap(locale)` before the external browser entry;
   initialize with `initializeRemixClientI18n({ createI18n })` before importing
   translated browser modules.
6. Import ordinary macros from `@palamedes/core/macro` and rich Remix UI macros
   from `@palamedes/remix/macro` in both server and browser source.

Locale controls must perform a full document navigation. This is a deliberate
part of the contract, not a missing client API: the next request resolves one
locale and emits matching SSR markup, document language, bootstrap catalog,
and browser runtime.

## Register Options

```ts
interface PalamedesRemixRegisterOptions {
  include?: RegExp
  exclude?: RegExp
  runtimeModule?: string
  keepSourceFallbacks?: boolean
  configPath?: string
  failOnMissing?: boolean
  failOnCompileError?: boolean
}
```

Defaults:

- `include`: `/\.(tsx?|jsx?|mjs)$/`
- `exclude`: `/[/\\]node_modules[/\\]/`
- `runtimeModule`: `"@palamedes/runtime"`
- `keepSourceFallbacks`: `true`
- `configPath`: unset — `.po` imports discover the Palamedes config from the
  imported catalog file's directory; relative paths resolve from there
- `failOnMissing` / `failOnCompileError`: `false` — missing translations and
  catalog diagnostics warn instead of failing `.po` compilation

The default intentionally excludes `.cjs` because the macro transform injects
ESM imports. Pass a custom `include` only if your hook also provides a
CommonJS-compatible runtime binding.

Vite and Next use the shared bundler default from `@palamedes/transform`, which
also includes `.cjs`. Remix keeps this narrower loader-only exception because
Node executes a `.cjs` load result as CommonJS rather than passing it through a
bundler.

Macro calls use the plain, framework-neutral getter; locale changes require
document navigation.

Production register hooks retain authored messages by default and still omit
translator comments and context metadata. This keeps a missing catalog entry
readable during deploy skew. Set `keepSourceFallbacks: false` when generated
source text cannot be shipped; a missing entry then renders its compiled id.
The parser-free runtime returns a retained ICU fallback as raw text rather than
adding a parser dependency, so use `@palamedes/core` when it must interpolate
and configure `onMissing` to observe misses.

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
import { createPalamedesRemixAssetLoader, PALEMEDES_REMIX_ASSET_PACKAGES } from "@palamedes/remix"
import { createAssetServer } from "remix/assets"

export const assetServer = createAssetServer({
  basePath: "/assets",
  allowFiles: ["app/routes.ts", "app/**/public/**"],
  allowPackages: ["remix", ...PALEMEDES_REMIX_ASSET_PACKAGES],
  sourceMaps: process.env.NODE_ENV === "development" ? "external" : undefined,
  scripts: {
    loaders: [createPalamedesRemixAssetLoader()],
  },
})
```

`PALEMEDES_REMIX_ASSET_PACKAGES` contains `@palamedes/core`,
`@palamedes/runtime`, and `@palamedes/remix`. They must be in `allowPackages`
because the browser bootstrap creates a parser-capable i18n instance, while
transformed modules import `getI18n()` for ordinary macros and the Remix
compiled component for rich messages. Remix rewrites those package imports to
served asset URLs. If `runtimeModule` selects another package, allow that exact
package name instead of `@palamedes/runtime`.

`PalamedesRemixAssetLoaderOptions` exposes the shared `include`, `exclude`,
`runtimeModule`, and `keepSourceFallbacks` options. Defaults match the Node
loader. Transform failures identify the source module and retain the original
error as their cause.

The browser loader only transforms script source. It does not claim `.po`
imports or load `palamedes.yaml`; server catalog compilation remains the job of
`@palamedes/remix/register`. Use the document bootstrap below to deliver the
selected catalog without a browser `.po` import.

With source maps enabled, Remix composes the Palamedes transform map with its
TS/JSX compilation map, later import rewrites, and production minification.
Browser traces and transform diagnostics therefore resolve to authored
TypeScript/TSX positions. Remix's watcher invalidates edited macro-bearing
browser modules and applies its normal HMR policy: accepted boundaries update
in place and other changes reload the document, without restarting the server.

PO and config files are not browser-asset dependencies because transformed
modules contain message identities rather than active catalogs. Under
`node --watch`, the server graph watches imported PO files and the injected
config dependency; either edit restarts the process, clears catalog/bootstrap
caches, and requires a full document reload. Custom development runners must
provide the equivalent restart.

## Server Request Scope

```ts
import type { CatalogMessages } from "@palamedes/core"
import { defineLocaleControls } from "@palamedes/core/locale"
import { createRemixI18nServer } from "@palamedes/remix/server"

const locales = defineLocaleControls({
  locales: ["en", "de"],
  defaultLocale: "en",
  cookies: { locale: "locale" },
})

const catalogs: Record<"en" | "de", CatalogMessages> = {
  en: {},
  de: {
    // Load compiled catalog messages for real apps.
  },
}

export const remixI18n = createRemixI18nServer({
  locales,
  strategy: "cookie",
  loadMessages(locale) {
    return catalogs[locale]
  },
})
```

Use `remixI18n.run(context, callback)` inside Remix actions, or install
`remixI18n.middleware()` on a fetch-router. The helper resolves the active
locale, creates and activates a Palamedes i18n instance, caches catalog messages
by locale at module scope, and preserves that request-local instance while a
returned `Response.body` is streamed.

Supported strategies are `cookie`, `route`, `subdomain`, and `tld`. Route
strategy reads `context.params.locale` by default; when that param is absent,
it falls back to the request URL's first path segment. Pass `routeParam` to use
a different param name. Cookie serialization is available through
`remixI18n.serializeLocaleCookie(locale)`.

Further `createRemixI18nServer` options: `createI18n` (factory for the
request-local instance), `cookieName` (default `"locale"`), and `cookieMaxAge`
(default one year, in seconds). `loadClientMessages(locale)` supplies a
serializable ICU string catalog when `loadMessages` contains executable server
messages. `catalogVersion` overrides the default deterministic content digest
with a non-empty string or a function of `{ locale, messages }`.

Besides `run()`, `middleware()`, and `serializeLocaleCookie()`, the server
object exposes `resolveLocale(input)` for standalone locale resolution,
`createI18n(locale)` for manual instance creation, and `get(context?)` — the
read accessor for the active request scope, which is how handlers running
under `middleware()` reach the current i18n instance. It also exposes
`createClientBootstrap(locale)` and `renderClientBootstrap(locale, options?)`.

## Client Document Bootstrap

Render the payload while the server request scope is active, using exactly the
locale already selected for the document:

```ts
const response = await remixI18n.run(context, ({ locale }) => {
  const bootstrap = remixI18n.renderClientBootstrap(locale)
  return new Response(
    `<!doctype html><html lang="${locale}"><body>${bootstrap}<script type="module" src="/assets/app.js"></script></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  )
})
```

The exact raw-markup insertion API depends on the Remix UI renderer. The
returned markup is an inert `<template id="palamedes-i18n-bootstrap">` whose
JSON is escaped so catalog text cannot terminate the element. It contains
`locale`, `catalogVersion`, and `messages`. It contains no executable script
and works with strict CSP when the browser entry itself is an allowed external
module.

Initialize before loading translated browser modules:

```ts
import { createI18n } from "@palamedes/core"
import { initializeRemixClientI18n } from "@palamedes/remix/client"

initializeRemixClientI18n({ createI18n })
await import("./app.js")
```

`initializeRemixClientI18n()` validates the complete payload, requires its
locale to exactly match `<html lang>`, loads its ICU strings, activates the
locale, and only then installs the runtime used by transformed calls. Invalid
payloads and parser-free runtimes fail before installation. Advanced hosts can
pass `bootstrap`, `document`, or `elementId` explicitly;
`readRemixI18nBootstrap()` provides validation without creating the runtime.

Generate `loadClientMessages` values with the serializable `messages` returned
by `compileCatalogArtifact()` from `@palamedes/core-node`. Imported `.po`
modules can contain executable compiled messages and must not be JSON
serialized; the server helper rejects such entries with a diagnostic. Install
`@palamedes/core-node` as a direct dependency when using this compilation API.

Locale selection is document-scoped. Cookie, route, subdomain, TLD, and
`Accept-Language` changes must perform a full navigation, producing a new
`<html lang>` and payload. The browser never requests `.po` files. The embedded
catalog shares the HTML response's cache lifetime, so vary shared caches by the
active locale inputs (`Vary: Cookie` or private caching for cookie-selected
pages) and invalidate the document when `catalogVersion` changes. Server and
client catalogs are cached per locale for the life of the server object;
restart development watch processes after catalog/config changes.

## Support Matrix

| Area                   | Support contract                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Server macros          | Ordinary macros transformed after `remix/node-tsx`                                        |
| Browser macros         | Ordinary macros transformed by the post-compile asset loader                              |
| Rich Remix UI messages | `Trans`, `Plural`, `Select`, and `SelectOrdinal` in server and browser modules            |
| Request scope          | Fetch requests and streamed responses through `createRemixI18nServer()`                   |
| Client catalog         | Inert document bootstrap with serializable ICU strings; browser `.po` imports unsupported |
| HMR and source maps    | Source edits invalidate through Remix; composed authored TS/TSX maps and diagnostics      |
| Remix UI Frames        | Document render and direct frame reload retain their own request-local locale             |
| Locale strategies      | Cookie, route, subdomain, TLD, and `Accept-Language`; switching reloads the document      |
| Public hosting         | Source example and CI proof available; public deployment not yet verified                 |

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

## Remix UI Frames and Rich Messages

Server-rendered Remix UI Frames are supported. Put the full document and the
endpoint used by each `<Frame>` inside `remixI18n.run()` (or middleware) so the
initial stream and direct frame reload each establish request-local i18n state.
The `remix-cookie` smoke test requests both `/frames` and
`/frames/locale-summary` with a German locale and verifies the same translated
frame content.

Ordinary JavaScript macros, including `t`, remain supported in Remix UI
components because they survive Remix's JSX lowering. The native transformer
also recognizes the binding identities imported from `remix/ui/jsx-runtime`
and `remix/ui/jsx-dev-runtime`; it can recover the static `Trans`, `Plural`,
`Select`, and `SelectOrdinal` structure and produce the same message identity as
authored TSX.

Use `Trans`, `Plural`, `Select`, and `SelectOrdinal` from
`@palamedes/remix/macro`. The transform targets
`@palamedes/remix/compiled`, whose `Trans` component produces branded Remix UI
nodes without a React dependency. Named tag placeholders preserve the supplied
Remix element's props while replacing its authored children with translated
children. Primitive placeholders, Remix elements, and nested node arrays are
supported. Missing or malformed compiled messages follow the same readable
source-fallback behavior as the other compiled renderers.

The macro types use Remix component handles and reject React-only element
shapes. Dynamic lowered trees and prop spreads are rejected with a source
diagnostic instead of being left as live macro calls.

## Migration From The Experimental Cookie Example

The earlier Remix cookie example kept demo catalogs inline and wired i18n
manually in the example controller. Move those pieces to the full-stack setup:

1. Add `palamedes.yaml` and checked-in `.po` catalog files.
2. Import catalog `messages` from `.po` files and load them through
   `createRemixI18nServer({ loadMessages })`.
3. Replace per-route manual locale activation with `remixI18n.run(context, ...)`
   or `remixI18n.middleware()`.
4. Keep the Node command order as
   `node --import remix/node-tsx --import @palamedes/remix/register server.ts`.
5. Install `createPalamedesRemixAssetLoader()` in the asset server, render the
   inert client bootstrap, and initialize it before translated browser modules.

## Tested Remix Version

The published peer range is `remix@^3.0.0-rc.1`; the examples are pinned to the
exact proven version, currently `remix@3.0.0-rc.1`. A newer prerelease or stable
release becomes supported only after all four example manifests move together
and both `pnpm verify:examples:smoke -- --framework remix` and
`pnpm verify:examples:browser -- --id remix-cookie` pass. `remix@next` may be
run as a non-blocking canary but does not expand the supported range by itself.

## Public Demo Readiness

The repository example and automated browser contract are ready for hosting,
but hosting is managed separately. Add a live-demo URL only after all of these
conditions are true:

- the published examples image contains the pinned Remix example;
- the smoke matrix and focused Remix Chromium check are green;
- the deployment is reachable over its final HTTPS hostname;
- locale navigation produces matching SSR, `<html lang>`, and bootstrap data;
- hydration, interaction, Frames, and browser-console checks pass against that
  deployment.

Until then, public pages link the repository example and label hosting as
pending instead of presenting an unverified URL.
