# @palamedes/runtime

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fruntime?logo=npm)](https://www.npmjs.com/package/@palamedes/runtime)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Small runtime primitives for Palamedes-transformed code.

When Palamedes rewrites message macros, the generated code expects a `getI18n()` function. `@palamedes/runtime` is the package that provides that contract in a way that works for browser code, server code, and framework integrations.

## When To Use This Package

Use `@palamedes/runtime` whenever transformed Palamedes code runs in your application.

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

## Backend Servers

The same runtime model also works in classic backend applications such as Hono,
Express, or custom Node servers.

The important requirement is request-local access to the active i18n instance.
The recommended pattern is `AsyncLocalStorage`:

```ts
import { AsyncLocalStorage } from "node:async_hooks"
import { createI18n } from "@palamedes/core"
import { setServerI18nGetter } from "@palamedes/runtime"

const i18nStorage = new AsyncLocalStorage<ReturnType<typeof createI18n>>()

setServerI18nGetter(() => i18nStorage.getStore())
```

Per request, resolve the locale from `Accept-Language`, cookies, session data,
or the user profile, then run the request inside `i18nStorage.run(i18n, ...)`.

For a fuller walkthrough, including Hono and Express examples, see:

- [Palamedes in backend servers](https://github.com/sebastian-software/palamedes/blob/main/docs/backend-servers.md)

## API

- `getI18n()`
- `setClientI18n(i18n)`
- `setServerI18nGetter(getter)`
- `resetI18nRuntime()`

## Related Packages

- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)
- [`@palamedes/transform`](https://www.npmjs.com/package/@palamedes/transform)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
