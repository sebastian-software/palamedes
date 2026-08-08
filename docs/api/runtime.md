# `@palamedes/runtime`

`@palamedes/runtime` provides the active i18n instance lookup used by transformed
macro output.

## Exports

- `getI18n<T>()`
- `setClientI18n(i18n)`
- `activateServerI18n(i18n)`
- `setServerI18nGetter(getter)`
- `resetI18nRuntime()`
- `I18nInstance`

The server subpath `@palamedes/runtime/server` exports:

- `createServerI18nScope<T>()`
- `CreateServerI18nScopeOptions`
- `ServerI18nScope`

## Client Runtime

```ts
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"

const i18n = createI18n()
setClientI18n(i18n)
```

Call `setClientI18n()` before translated client UI renders.

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
