# First Working Translation with Next.js

This guide takes an existing TypeScript Next.js 16 App Router application from
one message to one rendered translation. It uses Server Components on the Node
runtime. The [Next.js package README](../packages/next-plugin/README.md) and
[API reference](./api/next-plugin.md) cover Client Components, server actions,
and production options after this first path works.

Before installing the native CLI, check [Platform support](./platform-support.md).
Use Node.js `>=22.22` and an application on one of the published targets.

## 1. Install the packages

```bash
pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/next-plugin
pnpm add -D @palamedes/cli @palamedes/config
```

The Next integration requires Next.js 16. Keep `next`, `react`, and
`react-dom` from the App Router application itself.

## 2. Describe the catalogs

```yaml
# palamedes.yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [app, src]
```

## 3. Wire the Next plugin

```ts
// next.config.mjs
import { withPalamedes } from "@palamedes/next-plugin"

export default withPalamedes({})
```

`withPalamedes()` transforms macros and loads imported `.po` catalogs in the
Next build. Keep direct application catalog imports on `.po`; FCL is supported
as catalog storage but is not an import-loader format.

## 4. Create a request-local server runtime

Add the `.po` declaration once:

```ts
// src/po.d.ts
declare module "*.po" {
  import type { CompiledCatalogMessages } from "@palamedes/core/compiled"

  export const messages: CompiledCatalogMessages
}
```

Then add one server-only module. `createNextServerI18nScope()` follows the App
Router render lifetime, while `runWithServerI18n()` makes the translated UI
explicitly request-local.

```ts
// src/lib/i18n.server.ts
import "server-only"

import { cache } from "react"
import { createI18n } from "@palamedes/core/compiled"
import type { PalamedesI18n } from "@palamedes/core"
import { createNextServerI18nScope } from "@palamedes/next-plugin/server"
import { messages as deMessages } from "../locales/de.po"
import { messages as enMessages } from "../locales/en.po"

export const serverI18nScope = createNextServerI18nScope<PalamedesI18n>()

const loadActiveServerI18n = cache(async () => {
  const i18n = createI18n()
  i18n.load("en", enMessages)
  i18n.load("de", deMessages)
  i18n.activate("de")
  return i18n
})

export async function createActiveServerI18n() {
  const i18n = await loadActiveServerI18n()
  serverI18nScope.activate(i18n)
  return i18n
}

export function runWithServerI18n<Result>(i18n: PalamedesI18n, callback: () => Result): Result {
  return serverI18nScope.run(i18n, callback)
}
```

This smallest path deliberately fixes the locale to `de`. Replace that choice
with your cookie, route, subdomain, or account policy before adding a locale
switcher; [Locale strategies](./locale-strategies.md) shows the trade-offs.

## 5. Write and extract one Server Component message

```tsx
// src/app/page.tsx
import { t } from "@palamedes/core/macro"
import { createActiveServerI18n, runWithServerI18n } from "../lib/i18n.server"

function translateWelcome() {
  return t`Welcome to Palamedes`
}

export default async function Page() {
  const i18n = await createActiveServerI18n()
  return runWithServerI18n(i18n, () => <h1>{translateWelcome()}</h1>)
}
```

Run extraction:

```bash
pnpm exec pmds extract
```

It creates `src/locales/en.po` and `src/locales/de.po`.

## 6. Translate and run

In `src/locales/de.po`, set the extracted message's translation:

```po
msgid "Welcome to Palamedes"
msgstr "Willkommen bei Palamedes"
```

Then start the application:

```bash
pnpm dev
```

The `/` route renders `Willkommen bei Palamedes`. That proves macro
transformation, catalog extraction, `.po` loading, and request-local App Router
rendering work together.

## Add client code or server actions next

This first run keeps translated code in Server Components. For translated Client
Components using PO catalogs, enable `messageSplitting: true` in the second
`withPalamedes()` options argument. Palamedes then loads only the document
locale's fragments for evaluated client modules; a locale change requires a
document navigation.

Server Functions and Actions run in separate requests. When adding them, expose
`initializeServerFunctionI18n()` from `src/palamedes.server.ts` and enable the
plugin's `serverFunctions: true` option. Follow the complete examples in the
[Next.js package README](../packages/next-plugin/README.md#server-functions-and-actions)
instead of sharing page-render state with an action.

## What to read next

- [`@palamedes/next-plugin` API reference](./api/next-plugin.md)
- [Configuration reference](./configuration.md)
- [Locale strategies](./locale-strategies.md)
- [Next.js examples](https://github.com/sebastian-software/palamedes/tree/main/examples/nextjs-cookie)
- [Troubleshooting](./troubleshooting.md)
