# `@palamedes/extractor`

`@palamedes/extractor` exposes the native message extractor for Palamedes macro
syntax.

## Exports

- `extractMessages(source, filename)`
- `extractor`
- default export `extractor`
- `ExtractedMessageInfo`
- `PalamedesExtractor`

## `extractMessages(source, filename)`

Returns extracted source-string-first messages from a JavaScript or TypeScript
module.

```ts
import { extractMessages } from "@palamedes/extractor"

const messages = extractMessages(source, "App.tsx")
```

The CLI uses this capability through the native core when running
`pmds extract`.
