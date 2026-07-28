# `@palamedes/extractor`

`@palamedes/extractor` exposes the native message extractor for Palamedes macro
syntax.

## Exports

- `extractMessages(source, filename, mdxOptions?)`
- `createExtractor(options?)`
- `extractor`
- default export `extractor`
- `ExtractedMessageInfo`
- `PalamedesExtractor`
- `PalamedesExtractorOptions`

## `extractMessages(source, filename, mdxOptions?)`

Returns extracted source-string-first messages from a JavaScript, TypeScript,
or MDX module.

```ts
import { extractMessages } from "@palamedes/extractor"

const messages = extractMessages(source, "App.tsx")
```

For MDX, pass the same semantic options used by the CLI:

```ts
import { createExtractor, extractMessages } from "@palamedes/extractor"

const mdx = {
  translatableAttributes: ["alt", "title"],
  frontMatterFields: ["title", "description"],
}

const messages = extractMessages(source, "guide.mdx", mdx)
const configuredExtractor = createExtractor({ mdx })
```

The CLI uses this capability through the native core when running
`pmds extract`.
