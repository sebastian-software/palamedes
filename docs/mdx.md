# MDX Messages

Palamedes treats `.mdx` as a first-class source format. The native extractor
and the Vite compiler consume the same FerroMark semantic event stream, so a
message extracted by `pmds extract` is the same message rendered by the
compiled module.

## Setup

First-class MDX compilation requires Vite 7 or newer. Install the framework
package and use the Palamedes plugin before the framework Vite plugin:

```ts
import react from "@vitejs/plugin-react"
import { palamedes } from "@palamedes/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [palamedes(), react()],
})
```

For React, Palamedes marks generated `.mdx` modules as JSX automatically.

For Solid, set `framework: "solid"` on the plugin and opt `.mdx` into
`vite-plugin-solid` explicitly:

```ts
import solid from "vite-plugin-solid"
import { palamedes } from "@palamedes/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [palamedes({ framework: "solid" }), solid({ extensions: [".mdx"] })],
})
```

The plugin compiles for React unless told otherwise, so this option is required
for Solid. Framework selection controls only the rich-component contract;
runtime lookups stay hook-free. Extraction produces identical messages for both
frameworks, so the catalog config has no reason to know the application runtime.

Do not add React's JSX module type for Solid. Rolldown would otherwise lower
the module with React's automatic runtime before Solid's Babel preset sees it.
Projects that must remain on Vite 6 or older can continue using the macro and
catalog plugins with `palamedes({ mdx: false })`.

Palamedes and `@mdx-js/rollup` both claim `.mdx` modules. Do not enable both for
the same files; Palamedes runs as a pre-transform and intentionally owns the
full MDX compilation path.

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

Read the **guide** or visit [configuration](/docs/configuration).
```

extracts messages equivalent to:

```text
Hello {name}
Read the <0>guide</0> or visit <1>configuration</1>.
```

The generated module preserves `account.name` as the runtime expression behind
the `name` placeholder. Repeated expressions reuse the same placeholder. URLs,
image sources, fenced code blocks, and inline code are rendered but are not sent
to translators. Fenced code keeps a `language-*` class derived from its info
string.

## Configuration

```yaml
mdx:
  framework: react
  translatable-attributes: [alt, title, aria-label]
  front-matter-fields: [title, description]
  trans-module: "@palamedes/react/compiled"
  runtime-module: "@palamedes/runtime"
  ignore-directive: palamedes-ignore
```

| Field                     | Default                    | Purpose                                                     |
| ------------------------- | -------------------------- | ----------------------------------------------------------- |
| `framework`               | `react`                    | Generates React or Solid rich-component bindings.           |
| `translatable-attributes` | `[alt]`                    | Static JSX attributes extracted as standalone messages.     |
| `front-matter-fields`     | `[]`                       | Scalar frontmatter values extracted as standalone messages. |
| `trans-module`            | framework `/compiled` path | Module exporting parser-free `Trans`.                       |
| `runtime-module`          | `@palamedes/runtime`       | Advanced override for the module exporting `getI18n`.       |
| `ignore-directive`        | `palamedes-ignore`         | Marker used for an explicit per-unit opt-out.               |

TypeScript configs use the camelCase equivalents:
`translatableAttributes`, `frontMatterFields`, `transModule`,
`runtimeModule`, and `ignoreDirective`.

`translatable-attributes` replaces the default list rather than extending it.
Include `alt` explicitly when adding fields such as `title` or `aria-label`.
`href` and `src` remain structural attributes and are never extracted.
In Vite, the plugin's `framework` option selects the component contract for
compiled MDX; `mdx.framework` overrides it per config. Runtime access remains
hook-free. The plugin's `runtimeModule` option applies to macros only — use
`mdx.runtime-module` to point MDX at a different custom runtime explicitly.

The Vite plugin preserves inline source-message fallbacks in development and
strips them from generated MDX during production builds. Configure
`keepSourceFallbacks` on `palamedes()` when a production module must retain
those readable fallbacks. `MdxOptions` accepts the same key in data config, but
the Vite plugin overwrites it with its own build-output setting, so configure
the plugin option when using Vite.

A Vite MDX integration that is neither React nor Solid can set the Vite
plugin's top-level `framework: "none"` option to omit framework-specific MDX
compilation. The data-config override `mdx.framework` accepts only `"react"` or
`"solid"`; `@palamedes/remix` does not expose the Vite plugin option.

Translated frontmatter remains explicit. The compiler exports the original
scalar object as `frontmatter`; when configured fields are present it also
exports `getTranslatedFrontmatter()`, which resolves those fields through the
active i18n instance. Collection-valued frontmatter is omitted rather than
being stringified as a misleading scalar.

## Ignoring Content

Put the configured marker in a comment immediately before a semantic unit:

```mdx
{/* palamedes-ignore */}

This paragraph stays in the source language.
```

The content still renders, but no catalog message is created for that unit.
The directive covers the whole unit, including image alt text and configured
JSX attributes. JSX comments are the canonical MDX form; HTML comments are also
recognized and are omitted from rendered content.

## Diagnostics, Maps, and HMR

Malformed MDX produces structured, source-ranged diagnostics from FerroMark.
Footnotes currently produce an `UnsupportedFootnote` diagnostic instead of
silently compiling incorrect links. The Vite adapter reports diagnostic
locations as build errors and returns the native v3 source map for valid
modules. It watches the Palamedes config; catalog modules remain owned by the
normal PO loader and configured runtime.

Generated modules currently use the built-in HTML element mapping. They do not
yet implement MDXProvider or a `components` prop, and extracted messages do not
set `context`. Use imported JSX components directly when a page needs custom
rendering.

## Verified Example

[`examples/vite-mdx`](../examples/vite-mdx) is a complete three-page React/Vite
handbook with linked MDX modules, a shared English/German catalog, imported JSX
components, expressions, translated attributes, image alt text, code blocks,
and a document-level locale switch. It is part of `pnpm verify:examples`.

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
