# @palamedes/react-router-rsc

Experimental request-scoped i18n for React Router RSC Framework Mode Server
Functions.

React Router marks RSC as experimental and allows breaking changes in patch and
minor releases. This package is opt-in and supports the patch release lines
React Router `~8.3.0` and `@vitejs/plugin-rsc` `~0.5.34`. Its peer dependencies
allow compatible patch updates, but deliberately exclude later minor releases
until they have been verified. Review React Router's RSC release notes and rerun
the production fixture before upgrading either package beyond those ranges.

## Installation

```sh
pnpm add @palamedes/core @palamedes/runtime @palamedes/react-router-rsc
pnpm add -D @palamedes/cli @palamedes/vite-plugin @react-router/dev@~8.3.0 \
  @vitejs/plugin-rsc@~0.5.34 vite react-router@~8.3.0
```

`@palamedes/react-router-rsc` is ESM-only, matching React Router's RSC and Vite
runtime. Use `import`; CommonJS `require()` is deliberately unsupported.

This adapter supports only RSC Framework Mode. It does not change ordinary
React Router Framework Mode applications or route actions. RSC Data Mode owns
its RSC/SSR entry wiring, so it is not supported by this adapter.

## Configure the RSC entry once

Use the React Router RSC Vite plugin and Vite's experimental RSC plugin. React
Router requires its RSC plugin before `rsc()`:

```ts
// vite.config.ts
import { unstable_reactRouterRSC as reactRouterRSC } from "@react-router/dev/vite"
import { palamedes } from "@palamedes/vite-plugin"
import rsc from "@vitejs/plugin-rsc"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [palamedes(), reactRouterRSC(), rsc()],
})
```

Create `app/entry.rsc.tsx`. The resolver receives React Router's original
Fetch `Request`, including `headers` and `cookies`; it owns locale negotiation,
catalog loading, and activation of a **fresh** i18n instance.

```tsx
import defaultEntry from "@react-router/dev/config/default-rsc-entries/entry.rsc"
import { createReactRouterRscI18nRequestScope } from "@palamedes/react-router-rsc"
import type { RouterContextProvider } from "react-router"

import { createRequestI18n } from "./i18n"

const palamedesI18n = createReactRouterRscI18nRequestScope(createRequestI18n)

export default {
  fetch(request: Request, requestContext?: RouterContextProvider) {
    return palamedesI18n.run(request, () => defaultEntry.fetch(request, requestContext))
  },
}

if (import.meta.hot) {
  import.meta.hot.accept()
}
```

`createRequestI18n()` should load only the active locale before returning:

```ts
import { createI18n } from "@palamedes/core"
import { messages as de } from "./locales/de.po"
import { messages as en } from "./locales/en.po"

export function createRequestI18n(request: Request) {
  const locale = request.headers.get("cookie")?.includes("locale=de") ? "de" : "en"
  const i18n = createI18n()
  i18n.load(locale, locale === "de" ? de : en)
  i18n.activate(locale)
  return i18n
}
```

The entry wrapper starts before React Router calls
`unstable_matchRSCServerRequest`. It therefore covers Server Function argument
and default-parameter evaluation, dispatch, awaited work, RSC rendering,
automatic post-action revalidation, the SSR pass, and streams created during
that work. Initialization failures reject before React Router dispatches a
Server Function, with an error beginning `Palamedes React Router RSC i18n
initialization failed`.

## Current limits

- The adapter relies on Node's `AsyncLocalStorage` through
  `@palamedes/runtime/server`. Do not use it in Edge or Worker runtimes unless
  that runtime's Node-compatible async context propagation has been verified.
- `scope.run()` restores its caller's store when the default entry settles, but
  timers, promise continuations, stream callbacks, and other async resources
  created inside that scope inherit its request locale even if they run later.
  Work initiated separately without an inherited request context has no active
  locale; pass explicit data or create an appropriate new scope for it.
- React Router RSC runs separate RSC and SSR module graphs. The shared
  Palamedes runtime state and `AsyncLocalStorage` scope preserve locale
  isolation across both graphs, including concurrent requests.
- Vite graph splitting currently maps client chunks to active-locale catalog
  fragments. It does not expose an RSC Server Function module-to-fragment
  manifest, so this adapter cannot safely lazy-load only evaluated server
  fragments. Load the active locale's server catalog in the resolver. This is
  intentionally a documented limitation, not a transform fallback.
- Do not add the Next.js directive-aware Server Function transform. The RSC
  entry is earlier than parameter evaluation, while body instrumentation would
  be too late for eager macro defaults and would need the existing safety
  diagnostic.

## Validation

`examples/react-router-rsc-cookie` is the production-built browser fixture. It
calls a real top-level `"use server"` function from a Client Component, proves
direct/synchronous/asynchronous/cross-module macros and a default parameter,
then verifies concurrent English and German requests plus revalidation.

```sh
pnpm verify:react-router-rsc
```

## License

MIT © 2026 Sebastian Software
