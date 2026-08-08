# @palamedes/tanstack

Request-scoped i18n middleware for TanStack Start server functions.

## Installation

```sh
pnpm add @palamedes/core @palamedes/runtime @palamedes/tanstack @tanstack/react-start
```

`@palamedes/tanstack` is ESM-only. Use ESM imports; CommonJS
`require("@palamedes/tanstack")` is not supported.

## Global server-function middleware

Create the middleware once and register it in `src/start.ts`. The resolver gets
the original request, so it can read headers and cookies to negotiate a locale
and load its catalog. It must return a fresh activated i18n instance for each
request.

```ts
import { createIsomorphicFn, createStart } from "@tanstack/react-start"
import { createTanStackI18nRequestMiddleware } from "@palamedes/tanstack"

const palamedesI18n = createIsomorphicFn().server(() =>
  createTanStackI18nRequestMiddleware(async (request) => {
    const { createRequestI18n } = await import("./i18n.server")
    return await createRequestI18n(request)
  })
)()

export const startInstance = createStart(() => ({
  requestMiddleware: [palamedesI18n],
}))
```

Because Start includes `src/start.ts` in its client graph, put a resolver that
loads server-only catalogs inside `createIsomorphicFn().server()`. Start
removes that branch from the client build.

This request middleware filters itself to Start's `serverFn` handler type. It
does not activate i18n for page rendering or server routes. It starts before
Start decodes and invokes a server function, and keeps the request-local scope
active until its awaited `next()` completes.

## Per-function middleware

Use `createTanStackI18nMiddleware()` when only selected server functions need
i18n. Register the result in `functionMiddleware` for every server function,
or compose it with an individual function:

```ts
const palamedesI18n = createTanStackI18nMiddleware(resolveRequestI18n)

export const saveProfile = createServerFn({ method: "POST" })
  .middleware([palamedesI18n])
  .handler(async () => ({ message: t`Saved` }))
```

The global request middleware is the recommended default because its resolver
has a typed `Request` and covers Start's entire server-function request path.
The composable middleware uses Start's supported `getRequest()` server accessor
and begins before server-function validation and handler execution.

## Runtime requirements

`@palamedes/tanstack` uses `@palamedes/runtime/server`, which requires Node's
`AsyncLocalStorage`. It supports the pinned TanStack Start line
`@tanstack/react-start@^1.168.38` on Node.js 22.22 or later. Do not use this
adapter in Edge or Worker runtimes unless their Node-compatible
`AsyncLocalStorage` behavior has been independently verified.

The scope covers the complete awaited middleware and server-function invocation.
If a deployment detaches work after the function resolves, pass locale data to
that detached work explicitly; it is outside the request scope.

## License

MIT © 2026 Sebastian Software
