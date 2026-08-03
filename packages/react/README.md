# @palamedes/react

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Freact?logo=npm)](https://www.npmjs.com/package/@palamedes/react)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Provider-free React components, macro entry points, and headless frontend
primitives for Palamedes.

Use this package when your React app wants translated JSX that stays close to
the component, without making translation state another provider tree to manage.

## Installation

```bash
pnpm add @palamedes/core @palamedes/react
```

`@palamedes/core` is a direct runtime dependency of generated catalog modules,
which import `defineCompiledCatalog()` from its `compiled` entrypoint.

## Minimal Example

```tsx
import { Trans } from "@palamedes/react/macro"

export function Footer() {
  return (
    <footer>
      <Trans>
        Powered by <strong>Palamedes</strong>
      </Trans>
    </footer>
  )
}
```

For live client-side locale switches, point the macro transform at React's
external-store bridge:

```ts
palamedes()
```

The `@palamedes/react/runtime` subpath exports a React-aware `getI18n()` that
subscribes the rendering component to every `setClientI18n()` activation,
including re-activation of the same mutable instance. React Server Components
resolve the hook-free server implementation through the `react-server` export
condition.

`<Trans>`, `<Plural>`, `<Select>`, and `<SelectOrdinal>` use the same subscription
automatically. The transform override is needed for inline `t` / `plural` macro
calls. Because the reactive getter is a custom hook, those inline calls must run
unconditionally during a function-component or custom-hook render.

Rich JSX children are transformed to numeric component slots in the message, for
example `<0>Palamedes</0>`, while the React component is passed separately.
The transform imports `Trans` from `@palamedes/react/compiled`, which excludes
the ICU parser. Direct imports from `@palamedes/react` remain the compatibility
surface for hand-written runtime component patterns.

## Runtime Components

Besides the macro entry point, the package's main entry exports the runtime
components `Trans`, `Plural`, `Select`, and `SelectOrdinal` (plus the
`TransProps` type). These are what macro-transformed JSX renders through, and
all of them resolve messages through the active i18n instance. The choice
components accept plural categories (`zero` … `other`), exact matches written
as `_0`/`_1`/… (normalized to ICU `=N`, mirroring the macro transform), and
`offset`; invalid option props and option text with unbalanced braces are
rejected with a descriptive error instead of silently misrendering.

The package also re-exports React's `Fragment`: the macro transform emits
fragment-wrapped output and resolves `Fragment` from this package so
transformed modules need no extra `react` import.

## Headless Frontend Helpers

This package also exposes small, style-agnostic React helpers that the example
matrix uses directly:

- `useClientLocale(locale, sync)` from `@palamedes/react/client`
- `buildLocaleSwitchItems({ locales, currentLocale, labels, testIdPrefix? })`
- `LocaleSwitchItem<TLocale>`

These helpers are intentionally headless. They do not own routing, form
submission, styling, or cookie policy. They only cover the stable frontend
primitives that repeat across apps:

- keeping the active client locale synchronized
- building render-ready locale switch models for buttons, links, or forms

`useClientLocale` does not run its sync callback during SSR. If the initial HTML
contains translated client components, use `createClientCatalogBoundary()` for
generated catalogs or initialize `setClientI18n()` before hydration. All
hook-driven locale synchronization happens after commit.

```tsx
import { buildLocaleSwitchItems } from "@palamedes/react"
import { useClientLocale } from "@palamedes/react/client"

function LocaleToolbar({
  locale,
  sync,
}: {
  locale: "en" | "de"
  sync: (locale: "en" | "de") => void | Promise<void>
}) {
  useClientLocale(locale, sync)

  const items = buildLocaleSwitchItems({
    locales: ["en", "de"] as const,
    currentLocale: locale,
    labels: { en: "English", de: "Deutsch" },
  })

  return (
    <nav>
      {items.map((item) => (
        <button key={item.locale} data-testid={item.testId}>
          {item.label}
        </button>
      ))}
    </nav>
  )
}
```

## Render-Safe Client Catalogs

Next.js App Router applications can keep generated catalogs in per-locale
chunks while giving translated Client Components the right catalog on their
first hydration render. Define the boundary once in a `"use client"` module:

```tsx
"use client"

import { createClientCatalogBoundary } from "@palamedes/react/client"

type Locale = "en" | "de"

export const ClientCatalogBoundary = createClientCatalogBoundary<Locale>({
  loadCatalog: (locale) => import(`../locales/${locale}.po`),
})
```

Then render it from the Server Component after activating the same request
locale through `@palamedes/runtime/server`:

```tsx
const { locale } = await createActiveServerI18n()

return (
  <ClientCatalogBoundary locale={locale}>
    <TranslatedClientContent />
  </ClientCatalogBoundary>
)
```

The dynamic import keeps executable generated messages in a module chunk; they
are not serialized through React Server Components. The boundary suspends
hydration until that one module is available, creates a scoped parser-free i18n
instance, and only bridges it to `setClientI18n()` after commit. A discarded
concurrent render can load a module, but cannot activate it or notify runtime
subscribers.

Pass a changed `catalogRevision` string or number when the contents can refresh
without a locale change. The boundary will request a fresh resource and publish
the new instance after that render commits. The loader receives the revision as
its second argument, so version-aware sources can select fresh contents while
ordinary static imports can ignore it. Because this path uses module loading
rather than inline scripts, JSON source, or `eval`, it works with strict Content
Security Policies and with executable generated catalogs.

A rejected dynamic import is thrown to the nearest React error boundary. A
module without a generated, branded `messages` export fails through the
parser-free Core loader instead of silently falling back to runtime parsing.

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
