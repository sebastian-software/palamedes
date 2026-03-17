# Migration from Lingui to Palamedes

This migration is usually simpler than it looks.

The reason is straightforward: Palamedes does not throw away the best parts of Lingui. The macro shapes still feel familiar. What changes is the tooling stack, the runtime model, and the removal of older compatibility paths.

## Short Version

In most projects, the migration looks like this:

1. Switch framework integration to Palamedes.
2. Switch extraction to Palamedes.
3. Move runtime access to `getI18n()`.
4. Remove explicit authoring `id` paths.
5. Remove older accessor-specific runtime paths.
6. Verify build output, extraction, and app behavior.

## Concept Mapping

| Lingui world | Palamedes world |
| --- | --- |
| Lingui as the full product surface | Palamedes as the tooling and runtime surface |
| Mixed historical API surface | Smaller, more opinionated end state |
| Message identity sometimes mixed with explicit `id` paths | `message + context` as the only semantic identity |
| Multiple runtime access paths depending on context | One runtime model via `getI18n()` |
| Framework setup through Lingui adapters | Framework setup through `@palamedes/vite-plugin` or `@palamedes/next-plugin` |
| Extraction through Lingui CLI and Babel-oriented flows | Extraction through `@palamedes/extractor` and `pmds extract` |

## What Usually Stays the Same

Most macro forms remain familiar:

```ts
import { t, msg, defineMessage, plural, select, selectOrdinal } from "@lingui/core/macro"
```

```tsx
import { Trans, Plural, Select, SelectOrdinal } from "@lingui/react/macro"
```

The day-to-day workflow also stays recognizable:

- define messages with macros
- extract messages
- maintain catalogs
- keep runtime resolution centralized

## What You Should Change Deliberately

### 1. Move off older access paths

Palamedes does not keep multiple accessor-specific runtime paths as the preferred model.

If your code still assumes an older context-specific access pattern, move it to the runtime target model:

```ts
import { getI18n } from "@palamedes/runtime"
```

That aligns the rest of the system around one assumption.

### 2. Remove explicit authoring `id` paths

Palamedes is source-string-first. If your codebase still contains patterns like these, they need to go away during migration:

```ts
t({ id: "checkout.cta", message: "Buy now" })
defineMessage({ id: "checkout.cta", message: "Buy now" })
```

In Palamedes:

- `message` is the source string
- `context` disambiguates when needed
- `message + context` is the semantic identity

That keeps catalogs, diagnostics, and transform behavior aligned with gettext instead of splitting identity across two public concepts.

### 3. Replace framework integration

#### Vite

Before:

```ts
// vite.config.ts
// Lingui-specific setup
```

After:

```ts
import { palamedes } from "@palamedes/vite-plugin"

export default defineConfig({
  plugins: [palamedes()],
})
```

#### Next.js

Before:

```ts
// next.config.ts
// Lingui-specific setup
```

After:

```ts
import { withPalamedes } from "@palamedes/next-plugin"

export default withPalamedes(nextConfig)
```

### 4. Switch extraction

With Palamedes, extraction runs through the Palamedes toolchain:

```bash
pnpm exec pmds extract
```

For watch mode:

```bash
pnpm exec pmds extract --watch
```

## Typical Before/After Examples

### Direct macro stays a direct macro

Before:

```ts
import { t } from "@lingui/core/macro"

const title = t`Hello`
```

After:

```ts
import { t } from "@lingui/core/macro"

const title = t`Hello`
```

The difference is not at the callsite. It is in the tooling stack underneath.

### Move runtime access to the new model

Before:

```ts
// old context-specific access path
```

After:

```ts
import { getI18n } from "@palamedes/runtime"

const locale = getI18n().locale
```

### JSX macros still feel familiar

Before:

```tsx
import { Trans, Plural } from "@lingui/react/macro"

export function Example() {
  return (
    <>
      <Trans>Hello {name}</Trans>
      <Plural value={count} one="# item" other="# items" />
    </>
  )
}
```

After:

```tsx
import { Trans, Plural } from "@lingui/react/macro"

export function Example() {
  return (
    <>
      <Trans>Hello {name}</Trans>
      <Plural value={count} one="# item" other="# items" />
    </>
  )
}
```

Again, the visible surface often stays the same. The stack under it changes.

## Breaking Changes To Plan For

### `getI18n()` is the target runtime model

Palamedes is opinionated here. If your project relies heavily on multiple historical runtime access patterns, plan that consolidation explicitly.

### Explicit authoring IDs are no longer carried forward

Palamedes does not treat explicit `id` fields as a normal authoring model anymore.

If your existing code uses them, plan a real migration instead of expecting silent compatibility.

### Tooling names change

You are not just swapping internals. You are also moving to Palamedes package surfaces:

- `@palamedes/extractor`
- `@palamedes/transform`
- `@palamedes/vite-plugin`
- `@palamedes/next-plugin`
- `@palamedes/runtime`
- `pmds` for the CLI

### Less compatibility ballast

Palamedes is not trying to preserve every older shape forever. That is good for the final system, but it means migration should be done deliberately instead of relying on accidental compatibility.

## Recommended Order For Real Projects

### Small or new projects

1. Swap the tooling packages.
2. Move runtime access to `getI18n()`.
3. Run extraction.
4. Validate the build and app behavior.

### Larger existing projects

1. Replace framework integration.
2. Inventory runtime access paths.
3. Remove older accessor-specific patterns.
4. Validate extraction.
5. Test app behavior by route or feature.

## Done Checklist

- The build runs with the Palamedes plugin.
- Extraction runs through `pmds`.
- Runtime access uses `getI18n()`.
- There are no explicit authoring `id` paths left in the codebase.
- Catalogs are created or updated correctly.
- Error locations and source maps work in development tooling.
- Older accessor-specific runtime patterns are gone.

## Why The Migration Is Worth It

If you are coming from Lingui, Palamedes is not "less Lingui." It is the next, more focused version of the same good core idea:

- native core
- smaller transform stack
- source maps by default
- clearer runtime model
- less historical baggage

If you are already thinking about tooling speed, build clarity, maintainability, or runtime simplicity, this is a good moment to switch.

Continue here:

- [Palamedes vs. Lingui](./comparison-with-lingui.md)
