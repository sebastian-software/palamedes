# Next.js App Router on Node

Use this route for Next.js 16 App Router with the compiled adapter contract.
Check the installed target before editing. Preserve the app's Next, React, and
React DOM versions. Install compatible versions of `@palamedes/core`,
`@palamedes/react`, `@palamedes/runtime`, `@palamedes/next-plugin`, and
`server-only`, plus development dependencies `@palamedes/cli` and
`@palamedes/config`. Use the app's package manager and one compatible package set.

## Configuration

Merge `withPalamedes` into the existing config and preserve other wrappers and
options. The following files are a minimal recipe, not wholesale replacements.

```js
// next.config.mjs
import { withPalamedes } from "@palamedes/next-plugin";

export default withPalamedes({});
```

```yaml
# palamedes.yaml
locales: [en, de]
source-locale: en
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

Add `app` to `include` when routes live outside `src`. Preserve existing locales
and catalog layout rather than copying `en`/`de` into an established app.

## Request locale and runtime

This fixture negotiates a cookie with an English fallback. Replace its policy
with the app's existing validated cookie/route/account/header policy. Reading a
locale must not write a cookie. Do not share a mutable i18n instance globally.

```ts
// src/lib/locale.server.ts
import "server-only";
import { cookies } from "next/headers";

export async function resolveLocale() {
  const saved = (await cookies()).get("locale")?.value;
  return saved === "de" ? "de" : "en";
}
```

```ts
// src/lib/i18n.server.ts
import "server-only";
import { cache } from "react";
import { createNextServerI18n } from "@palamedes/next-plugin/server";
import { resolveLocale } from "./locale.server";

export const createActiveServerI18n = cache(async () =>
  createNextServerI18n({ locale: await resolveLocale() }),
);
```

Await initialization before calling translated helpers or rendering translated
children. This includes `generateMetadata` and any other translated server entry.
The factory loads compiled catalogs and activates the adapter's render-local
scope; a custom server getter or extra scope activation is unnecessary.

```tsx
// src/app/page.tsx
import { Trans } from "@palamedes/react/macro";
import { createActiveServerI18n } from "../lib/i18n.server";

function Welcome() {
  return (
    <h1>
      <Trans>Welcome to Palamedes</Trans>
    </h1>
  );
}

export default async function Page() {
  await createActiveServerI18n();
  return <Welcome />;
}
```

The document must use the same locale policy before Client Component entry
evaluation. Merge this into the existing root layout; retain its providers,
metadata, styles, and children.

```tsx
// src/app/layout.tsx
import type { ReactNode } from "react";
import { resolveLocale } from "../lib/locale.server";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await resolveLocale();
  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
```

## Server Functions and Actions

When the app has server functions, add or merge the conventional entry:

```ts
// src/palamedes.server.ts
import "server-only";
import { createNextServerI18n } from "@palamedes/next-plugin/server";
import { resolveLocale } from "./lib/locale.server";

export async function initializeServerFunctionI18n() {
  await createNextServerI18n({ locale: await resolveLocale() });
}
```

The plugin discovers this entry and awaits it for each function request. React's
render cache is not an action initialization mechanism. If the project already
owns `instrumentation.ts`, preserve its hooks and verify adapter composition.

For explicit preference changes, validate against supported locales, compare
the saved cookie value, and write only a changed preference. Do not mutate
cookies in the initializer or read-only actions. A switch must navigate the
whole document so server and client use the same newly selected locale.

## Extract and prove

Run `pmds extract` through the project's package manager. Translate the German
entry in `src/locales/de.po` to `Willkommen bei Palamedes` for this recipe.
Build and start Next.js, request the route with `locale=en` and `locale=de`, and
verify rendered headings and document `lang`. Also verify the app's Client
Components and actions when present. Keep `error.tsx`/`global-error.tsx`
independent of translations and offer full document reload recovery.

For additional API details, consult the **target version's** Next plugin docs
and [first-run guide](https://palamedes.dev/docs/nextjs-first-run). Check that
the public site describes the chosen target before copying further recipes.
