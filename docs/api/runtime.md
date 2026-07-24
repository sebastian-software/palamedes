# `@palamedes/runtime`

`@palamedes/runtime` provides the active i18n instance lookup used by transformed
macro output.

## Exports

- `getI18n<T>()`
- `setClientI18n(i18n)`
- `subscribeClientI18n(listener)`
- `setServerI18nGetter(getter)`
- `resetI18nRuntime()`
- `I18nInstance`

The server subpath `@palamedes/runtime/server` exports:

- `createServerI18nScope<T>()`
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

## `subscribeClientI18n(listener)`

Registers a listener invoked on every `setClientI18n()` call, including
re-activation of the same instance in place. Returns an unsubscribe function.

This is the bridge framework bindings use to connect the framework-agnostic
client runtime to their own reactivity system. `@palamedes/solid/runtime`, for
example, feeds it into a Solid signal so translated output re-renders on a live
locale switch. Application code rarely calls this directly.

```ts
const unsubscribe = subscribeClientI18n((i18n) => {
  // react to the newly activated client instance
})
```

## Server Runtime

For request-local server rendering, prefer `@palamedes/runtime/server`:

```ts
import { createServerI18nScope } from "@palamedes/runtime/server"
import type { PalamedesI18n } from "@palamedes/core"

export const serverI18n = createServerI18nScope<PalamedesI18n>()

serverI18n.activate(i18n)
```

`createServerI18nScope()` uses Node `AsyncLocalStorage`, so keep it out of
client bundles and Edge-only runtime paths.

## Test Reset

`resetI18nRuntime()` clears the active client and server runtime state. It is
intended for tests.
