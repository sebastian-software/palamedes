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
or MDX module, or from inline Vue and Svelte component script blocks. `.vue` inputs support
`<script setup>` and `<script>` with `js`, `jsx`, `ts`, or `tsx` languages.
`.svelte` inputs support JavaScript and TypeScript instance scripts and module
scripts (`<script module>` or legacy `<script context="module">`). Instance-level
translation calls are valid; module scripts retain function-scope restrictions.
Import macros in the same script block as their calls.

Template text and expressions are not extraction surfaces; author messages in
the script and render the resulting values in the template.

```ts
import { extractMessages } from "@palamedes/extractor";

const messages = extractMessages(source, "App.tsx");
```

For MDX, pass the same semantic options used by the CLI:

```ts
import { createExtractor, extractMessages } from "@palamedes/extractor";

const mdx = {
  translatableAttributes: ["alt", "title"],
  frontMatterFields: ["title", "description"],
};

const messages = extractMessages(source, "guide.mdx", mdx);
const configuredExtractor = createExtractor({ mdx });
```

The CLI uses this capability through the native core when running
`pmds extract`.
