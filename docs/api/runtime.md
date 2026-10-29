# `@palamedes/runtime`

`@palamedes/runtime` provides the active i18n instance lookup used by transformed
macro output.

## Exports

- `getI18n<T>()`
- `isServerEnvironment()`
- `setClientI18n(i18n)`
- `activateServerI18n(i18n)`
- `setServerI18nGetter(getter)`
- `resetI18nRuntime()`
- `I18nInstance`
- `CreateServerI18nScopeOptions`
- `ServerI18nScope`

`isServerEnvironment()` classifies the current runtime consistently across
Palamedes packages. Browser workers are client environments even when they do
not expose a `window` global.

The server subpath `@palamedes/runtime/server` exports:

- `createServerI18nScope<T>(options?)`
- `CreateServerI18nScopeOptions`
- `ServerI18nScope`
- `ServerI18nResolver`
- `CreateScopedI18nRunnerOptions`
- `ScopedI18nRunner`
- `createScopedI18nRunner(resolveI18n, options)`
- `createServerCatalogStore<TLocale>({ load })`
- `ServerCatalogStore`
- `ServerCatalogLoader`
- `ServerCatalogLoadContext`
- `ServerCatalogStoreStats`

The build-backed subpath `@palamedes/runtime/server/bundled` exports
`createBundledServerI18n({ locale, timeZone?, ...options })` and
`BundledServerI18nOptions`. It loads the active locale from the
`virtual:palamedes/server-catalogs` module that `@palamedes/vite-plugin`
generates for server builds and returns a fresh instance. Import it only from
code built by that plugin; elsewhere it fails to resolve instead of falling
back to source text.

The Node-only test subpath `@palamedes/runtime/server/test` is
**Internal** and test-only. It exports
`waitForServerI18nTestBarrier(request)`,
`markServerI18nTestBarrierReached(request, headers)`, and
`SERVER_I18N_TEST_BARRIER_REACHED_HEADER`. It is an opt-in two-request
rendezvous for server-scope isolation tests: it is inert until the test process
sets `PALAMEDES_I18N_TEST_BARRIER=1` and a request supplies the matching barrier
header. Browser and non-Node imports intentionally link against fallback
exports so bundlers can resolve every binding; calling either function then
throws a curated runtime error.

The Node-only subpath `@palamedes/runtime/node-macros` exports
`registerRuntimeMacros(manifest)` and `RuntimeMacroManifest`. It accepts the
manifest written by `pmds extract --runtime-manifest`, as an object, a file
path, or a `URL`. After registration, `t`, `plural`, `select`, and
`selectOrdinal` from `@palamedes/core/macro` render through `getI18n()` instead
of throwing. Calls missing from the manifest throw, and so does a second
registration in the same process. See
[Macros Without A Bundler](../backend-servers.md#macros-without-a-bundler).

The Node subpath `@palamedes/runtime/node` exports `defineNodeI18n({ generated })`
with `NodeI18nSetup`, `NodeI18nOptions`, and `CreateNodeI18n`. Without a
bundler it registers `macros.json` from `generated` and loads
`catalogs/<locale>.mjs` from there; it returns a function that creates a fresh
instance per `{ locale, timeZone?, ...options }`. A server build with
`@palamedes/vite-plugin` resolves the subpath to the bundled catalog store, so
the same module runs bundled and unbundled. See
[One Setup For Every Build](../backend-servers.md#one-setup-for-every-build).

## Client Runtime

```ts
import { createI18n } from "@palamedes/core";
import { setClientI18n } from "@palamedes/runtime";

const i18n = createI18n();
setClientI18n(i18n);
```

Call `setClientI18n()` before translated client UI renders.

Generated catalog modules register their messages through
`@palamedes/runtime/internal`. `setClientI18n()` flushes eager message
registrations that evaluated before the client instance existed, and throws if
the instance cannot `load()` them.

## Generated-Code Internals

`@palamedes/runtime/internal` is an **Internal** subpath. The Vite, Next.js and
Remix adapters emit imports of it; applications do not import it. It exports
`registerMessages`, `registerMessageLoaders`, `registerMessageLoaderGroup`,
`loadRegisteredMessages`, `initializeClientI18n`, `RegisteredMessages`, and
`RegisteredMessageLoader`. These names change together with the generators and
are not covered by SemVer; see the [stability table](../stability.md#subpath-tiers).

## `getI18n<T>()`

Returns the active runtime instance. Its `locale` is always a `string`.
Transformed macro code calls this automatically.

On the client, `getI18n()` reads the instance registered with
`setClientI18n()`. Browser Web Workers and Service Workers are client
environments even though they do not expose `window`, so generated
catalog bootstraps work there too. On the
server, `getI18n()` reads the active server getter.

`getI18n()` throws a descriptive error when no active client instance or server
getter result is available. Initialize the runtime before translated code runs.

`I18nInstance` is the `PalamedesI18n` type from `@palamedes/core`: `locale`,
`_()`, `load()`, `activate()` and `renderMessage()` are required, and `_()`
returns `string`. Register instances created by `createI18n()`. Adapter
generics such as `createServerI18nScope<T>()` accept only types that extend it,
so `getI18n()._()` is typed as `string` everywhere.

`setClientI18n()` throws when generated message registrations exist and the
instance has no `load()`.

## Server Runtime

For request-local server rendering, prefer `@palamedes/runtime/server`:

```ts
import { createServerI18nScope } from "@palamedes/runtime/server";
import type { PalamedesI18n } from "@palamedes/core";

export const serverI18n = createServerI18nScope<PalamedesI18n>();

serverI18n.activate(i18n);
```

`createServerI18nScope()` uses Node `AsyncLocalStorage`, so keep it out of
client bundles and Edge-only runtime paths. Create the scope once at module
level and reuse it for every request: each call allocates a new
`AsyncLocalStorage`, so calling it inside a request handler adds avoidable
per-request work. `scope.activate()` lasts for the
current inherited async context; `scope.run()` restores its caller when its
callback settles. Async resources created while either scope is active retain
that store when they execute later. Work started separately without inheriting
the request context has no active i18n, so pass explicit data or establish an
appropriate new scope. A host adapter can supply `requestKeyProvider` when the
framework exposes a stable render identity across context changes. Provider
IDs replace earlier registrations from the same adapter, so repeated dev/HMR
scope creation stays bounded, and instances are stored against weak request
keys.

Next.js App Router rendering has separate RSC and Client Component server
passes and can resume work from a context captured before activation. Use
`createNextServerI18nScope()` from `@palamedes/next-plugin/server` there rather
than configuring `requestKeyProvider` in application code.

Isomorphic SSR client-component bundles can call `activateServerI18n(i18n)` to
enter that existing request scope without importing the Node-only server
subpath. The helper requires `createServerI18nScope()` to have been configured
by the server entry point; it does not create a scope or make an i18n singleton
request-safe.

## Server Catalog Store

`createServerCatalogStore({ load })` shares complete compiled catalogs across
the requests of one server process. The framework adapters and
`createBundledServerI18n` use it; a custom server integration that loads its
own generated catalogs can use it the same way.

```ts
import { createI18n } from "@palamedes/core";
import { createServerCatalogStore } from "@palamedes/runtime/server";

const catalogs = createServerCatalogStore<"en" | "de">({
  // Return the generated catalog modules for one locale, in override order.
  load: async ({ locale }) => [(await import(`./generated/${locale}.mjs`)).messages],
});

export async function createRequestI18n(locale: "en" | "de") {
  const i18n = createI18n({ locale });
  i18n.load(locale, await catalogs.load(locale));
  return i18n;
}
```

`load` receives a `ServerCatalogLoadContext` with the `locale` and its current
`generation`, and returns the ordered `CompiledCatalogMessages` fragments for
that locale. Later fragments override earlier ones. Fragments must be generated
compiled catalogs; anything else rejects the load with a `TypeError`.

The returned `ServerCatalogStore` has these methods:

- `load(locale)` returns the merged, immutable catalog. Concurrent calls for a
  locale share one load, and later calls reuse the result without calling the
  loader again. A failed load is not cached, so the next call retries it.
- `getReady(locale)` returns the catalog when it has already loaded, without
  starting a load.
- `invalidate(locale?)` drops one locale, or every locale, and advances its
  generation. A load that was already running when the generation changed
  cannot replace the newer result. Hosts call it when catalogs change in
  development.
- `generation(locale)` returns the locale's generation, starting at `0`.
- `stats()` returns `ServerCatalogStoreStats`: `trackedLocales`,
  `readyLocales`, `inFlightLocales`, `retainedFragments`, and
  `retainedMessages`.

The store retains each loaded locale until it is invalidated, so a long-lived
process can eventually hold every locale it has served. Request instances
share the merged catalog: `i18n.load()` keeps the reference instead of copying
each message.

## Test Reset

`resetI18nRuntime()` clears the active client and server runtime state. It is
intended for tests.
