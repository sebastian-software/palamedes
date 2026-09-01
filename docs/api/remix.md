# `@palamedes/remix`

`@palamedes/remix` integrates Palamedes with Remix v3's Node loader and browser
asset pipelines.

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
- `createRemixI18nServer(options)`
- `createRemixI18nRequestScope(resolveI18n)`
- `remixI18nContext`

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
  scripts: {
    loaders: [createPalamedesRemixAssetLoader()],
  },
})
```

`PALEMEDES_REMIX_ASSET_PACKAGES` contains `@palamedes/runtime`. It must be in
`allowPackages` because transformed browser modules import `getI18n()` from that
package; Remix then rewrites the package import to its served asset URL. If
`runtimeModule` selects another package, allow that exact package name instead.

`PalamedesRemixAssetLoaderOptions` exposes the shared `include`, `exclude`,
`runtimeModule`, and `keepSourceFallbacks` options. Defaults match the Node
loader. Transform failures identify the source module and retain the original
error as their cause.

The browser loader only transforms script source. It does not claim `.po`
imports or load `palamedes.yaml`; server catalog compilation remains the job of
`@palamedes/remix/register`. Shipping catalogs to the browser and initializing
the active client i18n instance are separate application concerns.

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
(default one year, in seconds).

Besides `run()`, `middleware()`, and `serializeLocaleCookie()`, the server
object exposes `resolveLocale(input)` for standalone locale resolution,
`createI18n(locale)` for manual instance creation, and `get(context?)` — the
read accessor for the active request scope, which is how handlers running
under `middleware()` reach the current i18n instance.

## Current Scope

The Remix v3 support path covers:

- JS macros in server-loaded modules: `t`, `plural`, `select`, and
  `selectOrdinal`
- request-local i18n activation for Fetch `Request` handlers
- cookie, route, subdomain, TLD, and `Accept-Language` locale negotiation
- `.po` catalog imports through `@palamedes/remix/register`
- module-scope catalog message caching before request activation
- ordinary JS macros in browser assets through
  `createPalamedesRemixAssetLoader()`

The browser transform compiles macro call sites and imports the
framework-neutral runtime getter. Client catalog delivery, client runtime
initialization, and rich JSX messages are not part of this integration point.

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

Rich JSX macros are nevertheless not yet a supported Remix UI runtime surface.
The existing compiled `@palamedes/react` component returns React elements,
while Remix UI uses its own element and component model. Until a dedicated
Remix UI compiled-message runtime and macro entry exist, use the post-compile
loader for ordinary JavaScript macros only. Dynamic lowered trees and prop
spreads are rejected with a source diagnostic instead of being left as live
macro calls.

## Migration From The Experimental Cookie Example

The earlier Remix cookie example kept demo catalogs inline and wired i18n
manually in the example controller. Move those pieces to the server-first setup:

1. Add `palamedes.yaml` and checked-in `.po` catalog files.
2. Import catalog `messages` from `.po` files and load them through
   `createRemixI18nServer({ loadMessages })`.
3. Replace per-route manual locale activation with `remixI18n.run(context, ...)`
   or `remixI18n.middleware()`.
4. Keep the Node command order as
   `node --import remix/node-tsx --import @palamedes/remix/register server.ts`.

## Tested Remix Version

The Remix examples are pinned to `remix@3.0.0-rc.1`. Keep the examples pinned
to the exact prerelease that `pnpm verify:examples:smoke -- --framework remix`
validates.
