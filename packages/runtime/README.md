# @palamedes/runtime

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fruntime?logo=npm)](https://www.npmjs.com/package/@palamedes/runtime)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT OR Apache-2.0](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-0f172a.svg)](https://github.com/sebastian-software/palamedes#license)

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
import { createI18n } from "@palamedes/core";
import { setClientI18n } from "@palamedes/runtime";

const i18n = createI18n();
setClientI18n(i18n);
```

The public `I18nInstance` contract requires an initialized `locale: string`.
Custom adapters registered with the client or server runtime must expose that
property before registration.

Browser client registration also works in windowless Web Worker and Service
Worker globals. Graph-split bootstrap modules can therefore initialize and
resolve their client instance off the main thread.

For server-side rendering or server components, register a getter for the active request-local i18n instance:

```ts
import { setServerI18nGetter } from "@palamedes/runtime";

setServerI18nGetter(() => {
  return getRequestScopedI18n();
});
```

For Node server code, prefer the server-only helper subpath. It uses
`AsyncLocalStorage` internally and registers the runtime getter once when the
scope is created:

```ts
import { createI18n } from "@palamedes/core";
import { createServerI18nScope } from "@palamedes/runtime/server";

const serverI18n = createServerI18nScope<ReturnType<typeof createI18n>>();

serverI18n.activate(i18n);
renderTranslatedServerComponents();

await serverI18n.run(i18n, async () => {
  renderTranslatedRequestHandler();
});
```

All scopes created by this helper share the same runtime getter, so independently
created scopes do not disconnect transformed `getI18n()` calls from the scope
that was activated for the current async context. Framework adapters can also
provide a stable request key for hosts that resume rendering from an earlier
async context; application code should use the framework adapter rather than
constructing that provider itself.

Next.js App Router applications must use
`createNextServerI18nScope()` from `@palamedes/next-plugin/server`. A plain
`AsyncLocalStorage.enterWith()` lifetime does not cover Next's separate RSC and
Client Component server-render passes after suspension.

## Backend Servers

The same runtime model also works in classic backend applications such as Hono,
Express, or custom Node servers.

The important requirement is request-local access to the active i18n instance.
The recommended pattern is `@palamedes/runtime/server`:

```ts
import { createI18n } from "@palamedes/core";
import { createServerI18nScope } from "@palamedes/runtime/server";

const serverI18n = createServerI18nScope<ReturnType<typeof createI18n>>();
```

Per request, resolve the locale from `Accept-Language`, cookies, session data,
or the user profile. Use `serverI18n.activate(i18n)` only when the host preserves
the current Node async context after the initializer returns. Use
`serverI18n.run(i18n, ...)` for tightly scoped request-handler callbacks. Hosts
with multi-pass rendering or suspension need a framework adapter with a stable
request key; Next applications use `@palamedes/next-plugin/server`.

For a fuller walkthrough, including Hono and Express examples, see:

- [Palamedes in backend servers](https://github.com/sebastian-software/palamedes/blob/main/docs/backend-servers.md)

### Shared server catalog loads

Adapters that load generated catalogs dynamically can share complete immutable
catalogs within one Node process:

```ts
import { createI18n } from "@palamedes/core";
import { createServerCatalogStore } from "@palamedes/runtime/server";

const catalogs = createServerCatalogStore({
  async load({ locale, generation }) {
    const fragments = await loadGeneratedCatalogFragments(locale, generation);
    return fragments;
  },
});

const messages = await catalogs.load(requestLocale);
const i18n = createI18n({ locale: requestLocale, timeZone: requestTimeZone });
i18n.load(requestLocale, messages);
```

The loader runs once for concurrent requests for a locale and its ordered
compiled fragments are merged once per development generation. Later requests
reuse the frozen message functions and constants; request-local locale, time
zone, and i18n instances remain independent. Call `invalidate(locale)` after a
catalog or configuration edit so a new generation can load without letting an
older in-flight result replace it. Loader failures are evicted and can be
retried by the next request.

The ESM module loader may retain every locale module evaluated during a process
lifetime. The store therefore makes no bounded-LRU or external-cache promise;
hosts should choose their locale set and process lifetime accordingly.

## API

- `getI18n()`
- `isServerEnvironment()` classifies the current runtime consistently across
  Palamedes packages; browser workers count as client environments, while
  Cloudflare Workers that expose Cloudflare's documented
  [`navigator.userAgent` marker](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-navigator)
  count as a server runtime.
- `setClientI18n(i18n)`
- `activateServerI18n(i18n)`
- `setServerI18nGetter(getter)`
- `resetI18nRuntime()`
- `createServerI18nScope()` from `@palamedes/runtime/server` for Node runtimes
  - `scope.activate(i18n)` binds an i18n instance to the current async context
  - `scope.run(i18n, callback)` runs a callback inside a scoped async context
  - `scope.get()` returns the current scoped i18n instance, if one is active
  - `requestKeyProvider` is an adapter-only escape hatch for a stable host render
    identity; its symbol ID makes repeat registration bounded during dev HMR

When a request key is available, `scope.activate()` updates the instance stored
for that key. Multiple activations under the same key are last-write-wins, which
matches hosts such as Next where one render has one active instance.
`scope.run()` remains isolated to its callback and takes precedence over that
request-key fallback.

The `@palamedes/runtime/server` implementation imports Node `async_hooks`. In
non-Node bundles, the subpath resolves to a small fallback module that throws an
actionable Node-only error when called.

Isomorphic SSR client-component bundles can use `activateServerI18n(i18n)` from
the main entry point to enter an existing request scope without importing the
Node-only subpath. The server entry point must first configure the shared scope
with `createServerI18nScope()`. The helper does not make a shared i18n singleton
request-safe, so pass a fresh request-local instance.

## Related Packages

- [`@palamedes/vite-plugin`](https://www.npmjs.com/package/@palamedes/vite-plugin)
- [`@palamedes/next-plugin`](https://www.npmjs.com/package/@palamedes/next-plugin)
- [`@palamedes/transform`](https://www.npmjs.com/package/@palamedes/transform)

<!-- ferramenta-family:start -->

**palamedes** is part of the [Ferramenta](https://ferramenta.dev) family — Rust-native developer tools that keep the APIs the ecosystem already knows.

Siblings: [ferroni](https://sebastian-software.github.io/ferroni/) · [ferriki](https://github.com/sebastian-software/ferriki) · [ferromark](https://sebastian-software.github.io/ferromark/) · [ferrolex](https://github.com/sebastian-software/ferrolex) · [ferrocat](https://ferrocat.dev) · [ferrovia](https://github.com/sebastian-software/ferrovia) · [ferralk](https://github.com/sebastian-software/ferralk) · [ferrugo](https://github.com/sebastian-software/ferrugo).
<!-- ferramenta-family:end -->

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT OR Apache-2.0 © 2026 Sebastian Software
