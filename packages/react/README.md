# @palamedes/react

Provider-free React components, macro entry points, and headless frontend
primitives for Palamedes.

Use this package when your app wants JSX translation components such as `Trans` with Palamedes-owned React runtime behavior.

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
      <Trans>Powered by Palamedes</Trans>
    </footer>
  )
}
```

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
