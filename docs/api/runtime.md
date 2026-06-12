# `@palamedes/runtime`

`@palamedes/runtime` provides the active i18n instance lookup used by transformed
macro output.

## Exports

- `getI18n<T>()`
- `setClientI18n(i18n)`
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

Returns the active runtime instance. Transformed macro code calls this
automatically.

On the client, `getI18n()` reads the instance registered with
`setClientI18n()`. On the server, it reads the active server getter.

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
