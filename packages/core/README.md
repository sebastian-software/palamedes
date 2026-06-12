# @palamedes/core

Palamedes-owned i18n instance creation and macro entry points.

Use this package when you want the app-facing runtime piece of Palamedes: create
an i18n instance, author messages with macros, and let the surrounding tooling
handle extraction and catalogs.

## Installation

```bash
pnpm add @palamedes/core
```

## Minimal Example

```ts
import { createI18n } from "@palamedes/core"
import { setClientI18n } from "@palamedes/runtime"

const i18n = createI18n()

setClientI18n(i18n)
```

For authoring imports, use:

```ts
import { t } from "@palamedes/core/macro"
```

## Runtime Formatting

Palamedes supports the common ICU argument types that product UIs usually need
inside translated sentences:

```ts
i18n._(
  {
    message:
      "Paid {amount, number, ::currency/EUR} on {when, date, medium} at {when, time, short}",
  },
  {
    amount: 12.3,
    when: new Date(),
  }
)
```

Supported runtime styles:

- `{value, number}` plus `percent`, `integer`, and `::currency/ISO_CODE`
- `{value, date, short|medium|long|full}`
- `{value, time, short|medium|long|full}`

Full ICU skeleton validation belongs in the transform/catalog diagnostics layer;
unsupported runtime styles fall back to the default `Intl` formatter for the
argument type.
