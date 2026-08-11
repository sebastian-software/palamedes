# `@palamedes/runtime`

`@palamedes/runtime` provides the active i18n instance lookup used by transformed
macro output.

## Exports

- `getI18n<T>()`
- `setClientI18n(i18n)`
- `activateServerI18n(i18n)`
- `setServerI18nGetter(getter)`
- `resetI18nRuntime()`
- `registerMessages(catalogs, key?)`
- `registerMessageLoaders(key, loaders)`
- `registerMessageLoaderGroup(key, loaderGroups)`
- `loadRegisteredMessages(i18n, locale)`
- `initializeClientI18n(locale, createI18n)`
- `I18nInstance`
- `RegisteredMessages`
- `RegisteredMessageLoader`
- `CreateServerI18nScopeOptions`
- `ServerI18nScope`

The server subpath `@palamedes/runtime/server` exports:

- `createServerI18nScope<T>(options?)`
- `CreateServerI18nScopeOptions`
- `ServerI18nScope`
- `ServerI18nResolver`
- `CreateScopedI18nRunnerOptions`
- `ScopedI18nRunner`
- `createScopedI18nRunner(resolveI18n, options)`

The Node-only test subpath `@palamedes/runtime/server/test` exports
`waitForServerI18nTestBarrier(request)`,
`markServerI18nTestBarrierReached(request, headers)`, and
`SERVER_I18N_TEST_BARRIER_REACHED_HEADER`. It is an opt-in two-request
rendezvous for server-scope isolation tests: it is inert until the test process
sets `PALAMEDES_I18N_TEST_BARRIER=1` and a request supplies the matching barrier
header. Browser and non-Node imports intentionally link against fallback
exports so bundlers can resolve every binding; calling either function then
throws a curated runtime error.

## Client Runtime

```ts
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"

const i18n = createI18n()
setClientI18n(i18n)
```

Call `setClientI18n()` before translated client UI renders.

Generated graph-split catalogs register eager fragments with
`registerMessages()` or server-side lazy resources with the loader registration
helpers. `setClientI18n()` and `initializeClientI18n()` flush only eager message
registrations that evaluated before the client instance existed. Lazy loader
registrations are consumed explicitly by `loadRegisteredMessages()`; application
code normally needs these APIs only when building a custom graph-splitting
integration.

## `getI18n<T>()`

Returns the active runtime instance. Its `locale` is always a `string`.
Transformed macro code calls this automatically.

On the client, `getI18n()` reads the instance registered with
`setClientI18n()`. On the server, it reads the active server getter.

`getI18n()` throws a descriptive error when no active client instance or server
getter result is available. Initialize the runtime before translated code runs.

`I18nInstance.locale` is required. Custom adapters registered with the client or
server runtime must expose an initialized `locale: string`; adapters that
previously omitted the property or declared it as optional need to initialize it
before registration.

## Server Runtime

For request-local server rendering, prefer `@palamedes/runtime/server`:

```ts
import { createServerI18nScope } from "@palamedes/runtime/server"
import type { PalamedesI18n } from "@palamedes/core"

export const serverI18n = createServerI18nScope<PalamedesI18n>()

serverI18n.activate(i18n)
```

`createServerI18nScope()` uses Node `AsyncLocalStorage`, so keep it out of
client bundles and Edge-only runtime paths. `scope.activate()` lasts for the
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

## Test Reset

`resetI18nRuntime()` clears the active client and server runtime state. It is
intended for tests.
