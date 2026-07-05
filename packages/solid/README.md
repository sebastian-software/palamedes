# @palamedes/solid

[![npm version](https://img.shields.io/npm/v/%40palamedes%2Fsolid?logo=npm)](https://www.npmjs.com/package/@palamedes/solid)
[![CI](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/sebastian-software/palamedes/actions/workflows/ci.yml)
[![Sponsored by Sebastian Software](https://img.shields.io/badge/Sponsored%20by-Sebastian%20Software-0f172a.svg)](https://oss.sebastian-software.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-0f172a.svg)](https://github.com/sebastian-software/palamedes/blob/main/LICENSE)

Use this package when your Solid app wants translated JSX that feels native to
Solid: `Trans`, `Plural`, `Select`, and `SelectOrdinal`, plus a small headless
helper layer for locale-aware UI.

Palamedes keeps the runtime model provider-free. Transformed code resolves the
active i18n instance through `getI18n()` from
[`@palamedes/runtime`](https://github.com/sebastian-software/palamedes/tree/main/packages/runtime),
so your Solid app only needs to register the active client or server instance
before translated code runs.

This package is part of the verified SolidStart story in the example matrix. It
shares the same catalog model, runtime semantics, and Vite plugin path as the
React integrations while swapping only the JSX adapter layer.

## Install

```bash
pnpm add @palamedes/core @palamedes/solid @palamedes/runtime @palamedes/vite-plugin
pnpm add -D @palamedes/cli @palamedes/config vite-plugin-solid
```

## Example

```tsx
import { Trans } from "@palamedes/solid/macro"

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

When the Palamedes transform runs, macro imports are rewritten to runtime
imports from `@palamedes/solid`. Rich JSX children are transformed to numeric
component slots in the message, for example `<0>Palamedes</0>`, while the Solid
wrapper is passed separately.

## Headless Frontend Helpers

This package also exposes small Solid-native helpers that stay deliberately
headless:

- `createClientLocaleEffect(localeAccessor, sync)` from `@palamedes/solid/client`
- `buildLocaleSwitchItems({ locales, currentLocale, labels, testIdPrefix? })`
- `LocaleSwitchItem<TLocale>`

They do not own routing, styling, cookie policy, or server decisions. They only
cover the stable frontend primitives that repeat across apps:

- synchronizing the active client locale
- building render-ready locale switch models for links, buttons, or forms

```tsx
import { buildLocaleSwitchItems } from "@palamedes/solid"
import { createClientLocaleEffect } from "@palamedes/solid/client"

function LocaleToolbar(props: {
  locale: "en" | "de"
  sync: (locale: "en" | "de") => void | Promise<void>
}) {
  createClientLocaleEffect(() => props.locale, props.sync)

  const items = () =>
    buildLocaleSwitchItems({
      locales: ["en", "de"] as const,
      currentLocale: props.locale,
      labels: { en: "English", de: "Deutsch" },
    })

  return (
    <nav>
      {items().map((item) => (
        <button data-testid={item.testId}>{item.label}</button>
      ))}
    </nav>
  )
}
```

## Related Docs

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- [Example matrix](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)
- [Proof and benchmarks](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
