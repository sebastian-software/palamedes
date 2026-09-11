# First Working Translation with Next.js

This guide takes an existing TypeScript Next.js 16 App Router application from
one message to one rendered translation. It uses Server Components on the Node
runtime. The [Next.js package README](../packages/next-plugin/README.md) and
[API reference](./api/next-plugin.md) cover Client Components, server actions,
and production options after this first path works.

Before installing the native CLI, check [Platform support](./platform-support.md).
Use Node.js `>=22.0.0` and an application on one of the published targets.

## 1. Install the packages

```bash
pnpm add @palamedes/core @palamedes/react @palamedes/runtime @palamedes/next-plugin server-only
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
import { withPalamedes } from "@palamedes/next-plugin";

export default withPalamedes({});
```

`withPalamedes()` transforms macros and automatically compiles and loads the
configured PO catalogs. The application chooses its locale; no catalog imports,
loader maps, or client catalog boundary are required.

## 4. Create a request-local server runtime

Add one server-only module. The adapter loads the active locale lazily and
shares immutable catalog content across requests. The returned instance keeps
locale, time zone, and callbacks local to the current Next render.

```ts
// src/lib/i18n.server.ts
import "server-only";

import { cache } from "react";
import { createNextServerI18n } from "@palamedes/next-plugin/server";

export const createActiveServerI18n = cache(() => createNextServerI18n({ locale: "de" }));
```

This smallest path deliberately fixes the locale to `de`. Replace that choice
with your cookie, route, subdomain, or account policy before adding a locale
switcher; [Locale strategies](./locale-strategies.md) shows the trade-offs.

## 5. Write and extract one Server Component message

```tsx
// src/app/page.tsx
import { t } from "@palamedes/core/macro";
import { createActiveServerI18n } from "../lib/i18n.server";

function translateWelcome() {
  return t`Welcome to Palamedes`;
}

export default async function Page() {
  await createActiveServerI18n();
  return <h1>{translateWelcome()}</h1>;
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

Client Components automatically await their selected compiled fragments for the
locale in `<html lang>`. Set that attribute from the same locale policy used on
the server. A locale change requires a document navigation. Optional
`data-palamedes-time-zone` on `<html>` selects the client formatting time zone.

Server Functions and Actions run in separate requests. Expose
`initializeServerFunctionI18n()` from `src/palamedes.server.ts`, resolve the
request locale there, and await `createNextServerI18n({ locale })`. The plugin
automatically discovers and invokes this conventional entry before action code.

Keep ordinary `error.tsx` and `global-error.tsx` views independent of translated
catalogs. A required fragment failure stops the dependent module and reaches
Next error handling; a missing compiled entry throws. Offer a full document
reload to recover after deployment or network failures, because the module
loader can cache rejected imports. Error UI should use a generic explanation
rather than display internal message IDs or raw diagnostic text.

## What to read next

- [`@palamedes/next-plugin` API reference](./api/next-plugin.md)
- [Configuration reference](./configuration.md)
- [Locale strategies](./locale-strategies.md)
- [Next.js examples](https://github.com/sebastian-software/palamedes/tree/main/examples/nextjs-cookie)
- [Troubleshooting](./troubleshooting.md)
