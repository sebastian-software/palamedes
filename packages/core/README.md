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
