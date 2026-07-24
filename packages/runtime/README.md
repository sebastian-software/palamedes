# @palamedes/runtime

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fruntime?logo=npm)](https://www.npmjs.com/package/@palamedes/runtime)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Small runtime primitives for Palamedes-transformed code.

When Palamedes rewrites message macros, the generated code expects a
`getI18n()` function. `@palamedes/runtime` provides that contract for browser
code, server code, framework integrations, and backend request handlers.

## When To Use This Package

Use `@palamedes/runtime` whenever transformed Palamedes code runs in your
application. It is the small shared contract that keeps translated code from
caring which framework is hosting it.

You typically install it together with:

- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)

## Installation

```bash
pnpm add @palamedes/runtime
```

## Minimal Example

```ts
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"

const i18n = createI18n()
setClientI18n(i18n)
```

For server-side rendering or server components, register a getter for the active request-local i18n instance:

```ts
import { setServerI18nGetter } from "@palamedes/runtime"

setServerI18nGetter(() => {
  return getRequestScopedI18n()
})
```

For Node server code, prefer the server-only helper subpath. It uses
`AsyncLocalStorage` internally and registers the runtime getter once when the
scope is created:

```ts
import { createI18n } from "@palamedes/core"
import { createServerI18nScope } from "@palamedes/runtime/server"

const serverI18n = createServerI18nScope<ReturnType<typeof createI18n>>()

serverI18n.activate(i18n)
renderTranslatedServerComponents()

await serverI18n.run(i18n, async () => {
  renderTranslatedRequestHandler()
})
```

All scopes created by this helper share the same runtime getter, so independently
created scopes do not disconnect transformed `getI18n()` calls from the scope
that was activated for the current async context.

## Backend Servers

The same runtime model also works in classic backend applications such as Hono,
Express, or custom Node servers.

The important requirement is request-local access to the active i18n instance.
The recommended pattern is `@palamedes/runtime/server`:

```ts
import { createI18n } from "@palamedes/core"
import { createServerI18nScope } from "@palamedes/runtime/server"

const serverI18n = createServerI18nScope<ReturnType<typeof createI18n>>()
```

Per request, resolve the locale from `Accept-Language`, cookies, session data,
or the user profile. Use `serverI18n.activate(i18n)` when framework rendering
continues after the initializer returns, as in React Server Components. Use
`serverI18n.run(i18n, ...)` for tightly scoped request-handler callbacks.

For a fuller walkthrough, including Hono and Express examples, see:

- [Palamedes in backend servers](https://github.com/sebastian-software/palamedes/blob/main/docs/backend-servers.md)

## API

- `getI18n()`
- `getClientI18nSnapshot()`
- `setClientI18n(i18n)`
- `subscribeClientI18n(listener)`
- `activateServerI18n(i18n)`
- `setServerI18nGetter(getter)`
- `resetI18nRuntime()`
- `createServerI18nScope()` from `@palamedes/runtime/server` for Node runtimes
  - `scope.activate(i18n)` binds an i18n instance to the current async context
  - `scope.run(i18n, callback)` runs a callback inside a scoped async context
  - `scope.get()` returns the current scoped i18n instance, if one is active

The `@palamedes/runtime/server` implementation imports Node `async_hooks`. In
non-Node bundles, the subpath resolves to a small fallback module that throws an
actionable Node-only error when called.

Isomorphic SSR client-component bundles can use `activateServerI18n(i18n)` from
the main entry point to enter an existing request scope without importing the
Node-only subpath. The server entry point must first configure the shared scope
with `createServerI18nScope()`. The helper does not make a shared i18n singleton
request-safe, so pass a fresh request-local instance.

`subscribeClientI18n(listener)` is intended for framework bindings such as the
Solid reactivity bridge. It fires when `setClientI18n()` is called and returns
an unsubscribe function. `getClientI18nSnapshot()` pairs the active instance
with a monotonic revision so external-store bindings can also observe
re-activation of the same mutable instance.

## Related Packages

- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)
- [`@palamedes/transform`](https://www.npmjs.com/package/@palamedes/transform)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
