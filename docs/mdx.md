# MDX Messages

Palamedes treats `.mdx` as a first-class source format. The native extractor
and the Vite compiler consume the same FerroMark semantic event stream, so a
message extracted by `pmds extract` is the same message rendered by the
compiled module.

## Setup

Install the framework package and use the Palamedes plugin before the framework
Vite plugin:

```ts
import react from "@vitejs/plugin-react"
import { palamedes } from "@palamedes/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [palamedes(), react()],
})
```

For Solid, use `vite-plugin-solid` and set the framework in
`palamedes.yaml`:

```yaml
locales: [en, de]
source-locale: en
mdx:
  framework: solid
catalogs:
  - path: src/locales/{locale}
    include: [src]
```

Run normal catalog extraction after adding an MDX file:

```bash
pmds extract
```

Directory include patterns discover `.mdx` alongside JavaScript and
TypeScript.

## Translation Units

Palamedes derives messages from rendered semantics rather than raw Markdown
tokens:

- each heading, paragraph, list item, blockquote paragraph, and table cell is
  its own message
- inline emphasis, links, and JSX become rich placeholders
- MDX expressions become named value placeholders
- image alt text is extracted separately
- configured static JSX attributes and frontmatter scalar fields are extracted
  separately

For example:

```mdx
# Hello {account.name}

Read the **guide** or visit [support](/support).
```

extracts messages equivalent to:

```text
Hello {name}
Read the <0>guide</0> or visit <1>support</1>.
```

The generated module preserves `account.name` as the runtime expression behind
the `name` placeholder. URLs, image sources, fenced code blocks, and inline code
are rendered but are not sent to translators.

## Configuration

```yaml
mdx:
  framework: react
  translatable-attributes: [alt, title, aria-label]
  front-matter-fields: [title, description]
  trans-module: "@palamedes/react"
  runtime-module: "@palamedes/react/runtime"
  ignore-directive: palamedes-ignore
```

| Field                     | Default                      | Purpose                                                     |
| ------------------------- | ---------------------------- | ----------------------------------------------------------- |
| `framework`               | `react`                      | Generates React or Solid rich-component bindings.           |
| `translatable-attributes` | `[alt]`                      | Static JSX attributes extracted as standalone messages.     |
| `front-matter-fields`     | `[]`                         | Scalar frontmatter values extracted as standalone messages. |
| `trans-module`            | framework package            | Module exporting `Trans`.                                   |
| `runtime-module`          | framework `/runtime` subpath | Module exporting the reactive `getI18n`.                    |
| `ignore-directive`        | `palamedes-ignore`           | Marker used for an explicit per-unit opt-out.               |

TypeScript configs use the camelCase equivalents:
`translatableAttributes`, `frontMatterFields`, `transModule`,
`runtimeModule`, and `ignoreDirective`.

Translated frontmatter remains explicit. The compiler exports the original
scalar object as `frontmatter`; when configured fields are present it also
exports `getTranslatedFrontmatter()`, which resolves those fields through the
active i18n instance.

## Ignoring Content

Put the configured marker in a comment immediately before a semantic unit:

```mdx
{/* palamedes-ignore */}

This paragraph stays in the source language.
```

The content still renders, but no catalog message is created for that unit.

## Diagnostics, Maps, and HMR

Malformed MDX produces structured, source-ranged diagnostics from FerroMark.
The Vite adapter reports those locations as build errors and returns the native
v3 source map for valid modules. It watches the Palamedes config and configured
catalog files; changing either invalidates affected MDX modules so development
renders use the current configuration and translations.

## Architecture Boundary

FerroMark owns MDX recognition and the versioned semantic event stream.
`crates/palamedes` owns translation-unit selection, rich/value placeholder
construction, message identity, diagnostics conversion, and JSX module
lowering. The native CLI and typed N-API binding both call that core workflow.
`@palamedes/vite-plugin` is intentionally a thin host adapter: it selects
`.mdx` modules, forwards configuration, registers watch files, and returns the
native code and source map.

This boundary prevents extraction and compilation from developing separate
Markdown heuristics.
