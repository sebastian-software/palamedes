# @palamedes/extractor

High-performance message extractor for [Lingui](https://lingui.dev) using [oxc-parser](https://oxc.rs).

## Why?

The default Babel-based extractor is powerful but slow. This extractor uses oxc-parser, which is written in Rust and is **20-100x faster** than Babel for parsing JavaScript/TypeScript.

**Benchmark results (100 files, 2000 messages):**

| Extractor | Time |
|-----------|------|
| Babel     | ~1500ms |
| **oxc**   | **~15ms** |

## Installation

```bash
pnpm add @palamedes/extractor
```

## Usage

```ts
// lingui.config.ts
import { extractor } from '@palamedes/extractor'

export default {
  locales: ['en', 'de', 'fr'],
  sourceLocale: 'en',
  catalogs: [
    {
      path: '<rootDir>/src/locales/{locale}',
      include: ['src'],
    },
  ],
  extractors: [extractor],
}
```

## Supported Syntax

### JSX Macros

```tsx
import { Trans, Plural, Select, SelectOrdinal } from '@lingui/react/macro'

// Trans
<Trans>Hello {name}</Trans>
<Trans id="greeting">Hello World</Trans>
<Trans id="greeting" message="Hello {name}">...</Trans>

// Plural
<Plural value={count} one="# item" other="# items" />

// Select
<Select value={gender} male="He" female="She" other="They" />

// SelectOrdinal
<SelectOrdinal value={position} one="#st" two="#nd" few="#rd" other="#th" />
```

### JS Macros

```ts
import { t, msg, defineMessage, plural, select, selectOrdinal } from '@lingui/core/macro'

// Tagged template
t`Hello ${name}`
msg`Hello World`

// Object descriptor
t({ id: 'greeting', message: 'Hello' })
defineMessage({ id: 'greeting', message: 'Hello {name}' })

// Plural/Select functions
plural(count, { one: '# item', other: '# items' })
select(gender, { male: 'He', female: 'She', other: 'They' })
```

### useLingui Hook

```tsx
import { useLingui } from '@lingui/react/macro'

function MyComponent() {
  const { t } = useLingui()
  return <div>{t`Hello ${name}`}</div>
}
```

### Runtime Calls (i18n._)

```ts
import { i18n } from '@lingui/core'

// String ID
i18n._("greeting")

// Message descriptor
i18n._({ id: "greeting", message: "Hello" })

// With values and descriptor
i18n._("greeting", { name }, { message: "Hello {name}" })

// Tagged template
i18n.t`Hello ${name}`

// Also works with this.i18n or obj.i18n
this.i18n._("greeting")
```

## Limitations

- Does not support `// lingui-extract-ignore` comments (yet)

## License

MIT
