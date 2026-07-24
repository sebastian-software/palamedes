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
pnpm add @palamedes/react
```

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

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software

Rich JSX children are transformed to numeric component slots in the message, for
example `<0>Palamedes</0>`, while the React component is passed separately.

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
contains translated client components, initialize `setClientI18n()` before
hydration; subsequent locale changes are synchronized after commit.

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
