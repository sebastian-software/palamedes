# Palamedes Architecture Decisions

This document records key architectural and API decisions for the Palamedes project (next-generation Lingui tooling).

---

## ADR-001: Standalone Repository

**Status:** Accepted
**Date:** 2025-12 (revised 2026-03)

### Context

Palamedes started as packages inside the Lingui monorepo fork. Maintaining sync with upstream became increasingly difficult as Lingui evolved (v5.x → v6.0). The Palamedes packages are independent and only depend on Lingui as an external library.

### Decision

- Standalone repository at `github.com/sebastian-software/palamedes`
- Packages live in `packages/`, examples in `examples/`
- Package scope: `@palamedes/*`
- Lingui packages (`@lingui/conf`, `@lingui/core`, `@lingui/react`) are external dependencies with version ranges

### Consequences

- No more fork maintenance or rebase conflicts
- Independent release cycle
- Clear ownership and simpler CI/CD

---

## ADR-002: OXC over Babel/SWC for Macro Transformation

**Status:** Accepted
**Date:** 2025-12

### Context

Lingui currently uses Babel macros (via `babel-plugin-macros`) or SWC plugins for compile-time transformation. Both have drawbacks:
- Babel: Slow, complex configuration
- SWC: Rust-based, harder to maintain, version coupling issues

### Decision

Use [OXC](https://oxc-project.github.io/) (oxc-parser) for AST parsing and transformation:
- Fast JavaScript-native parser
- Simple walker API
- No complex plugin system needed
- Source map support via `magic-string`

### Consequences

- Single transformation implementation works across all build tools
- Faster builds
- Easier maintenance (pure TypeScript)
- Framework adapters (Vite, Next.js) are thin wrappers

---

## ADR-003: `useLingui()` vs `getLingui()` Macros

**Status:** Accepted
**Date:** 2025-12

### Context

Lingui provides `useLingui()` hook for reactive translations in React. However:
1. The `use` prefix implies a React Hook
2. Hooks don't work in React Server Components (RSC)
3. LLMs and developers often assume `use*` = Hook = Client-only

### Decision

Provide two macros with different semantics:

| Macro | Import | Output | Use Case |
|-------|--------|--------|----------|
| `useLingui()` | `@lingui/react/macro` | `_()` from hook | Client Components |
| `getLingui()` | `@lingui/core/macro` | `i18n._()` | Server Components, anywhere |

**`useLingui()` (Client Components):**
```tsx
import { useLingui } from "@lingui/react/macro"

function ClientComponent() {
  const { t, plural } = useLingui()
  return <div>{t`Hello`}</div>
}

// Transforms to:
import { useLingui } from "@lingui/react"

function ClientComponent() {
  const { _ } = useLingui()
  return <div>{_({ id: "...", message: "Hello" })}</div>
}
```

**`getLingui()` (Server Components):**
```tsx
import { getLingui } from "@lingui/core/macro"

async function ServerPage() {
  const { t, plural } = getLingui()
  return <div>{t`Hello`}</div>
}

// Transforms to:
import { i18n } from "@lingui/core"

async function ServerPage() {
  return <div>{i18n._({ id: "...", message: "Hello" })}</div>
}
```

### Rationale

- `get` prefix has no Hook connotation
- Clear mental model: `use` = reactive/context, `get` = direct access
- Works naturally with RSC where `i18n` is set up per-request
- LLM-friendly: no confusion about Hook rules

### Consequences

- Two entry points instead of one
- Clearer documentation needed
- Better RSC support out of the box

---

## ADR-004: `<Trans>` Always Transforms to React Component

**Status:** Accepted
**Date:** 2025-12

### Context

The `<Trans>` macro could transform to either:
1. `i18n._()` call (simpler, but not reactive)
2. `<Trans>` component from `@lingui/react` (reactive via context)

### Decision

Always transform `<Trans>` macro to the `<Trans>` component:

```tsx
// Input
<Trans>Hello {name}</Trans>

// Output
<Trans id="..." message="Hello {name}" values={{ name }} />
```

For nested JSX elements, pass them via `components` prop:

```tsx
// Input
<Trans>Click <a href="/link">here</a></Trans>

// Output
<Trans
  id="..."
  message="Click <0>here</0>"
  components={{ 0: <a href="/link" /> }}
/>
```

### Rationale

- Ensures reactivity (responds to language changes)
- Consistent with user expectations (`<Trans>` looks like a component)
- Handles nested elements correctly
- Works with `I18nProvider` context

### Consequences

- Requires `@lingui/react` as runtime dependency when using `<Trans>`
- Slightly more runtime overhead than `i18n._()` (acceptable trade-off)

---

## ADR-005: Message ID Generation

**Status:** Accepted
**Date:** 2025-12

### Context

Lingui generates stable message IDs from message content. IDs are used internally and don't need to be backwards-compatible.

### Decision

Use `generateMessageIdSync()` from pofile-ts:

```typescript
import { generateMessageIdSync } from "pofile-ts"

const id = generateMessageIdSync("Hello {name}", "greeting")
// => "qAzMJBud" (8 chars)
```

- **Algorithm:** SHA256 hash, base64url encoded, truncated to 8 characters
- **Inputs:** Message string + optional context

### Consequences

- Single implementation across all packages (format-po, format-po-gettext, babel-plugin-lingui-macro, oxc-transform, extractor-oxc)
- 8-character IDs are more collision-resistant than previous 6-character IDs
- No external crypto dependencies (uses Web Crypto API)

---

## ADR-006: Framework Adapter Architecture

**Status:** Accepted
**Date:** 2025-12

### Context

Need to support multiple build tools (Vite, Next.js, webpack, etc.) with the OXC transformer.

### Decision

Three-layer architecture:

```
┌─────────────────────────────────────────┐
│  Framework Adapters                     │
│  (vite-plugin-oxc, next-lingui-oxc)     │
├─────────────────────────────────────────┤
│  Core Transform                         │
│  (oxc-transform)                        │
├─────────────────────────────────────────┤
│  OXC Parser + magic-string              │
│  (dependencies)                         │
└─────────────────────────────────────────┘
```

- `oxc-transform`: Pure transformation logic, no framework dependencies
- Framework adapters: Thin wrappers that integrate with build tool APIs

### Consequences

- Easy to add new framework support
- Core logic is testable in isolation
- No build tool lock-in

---

## ADR-007: Source Map Support

**Status:** Accepted
**Date:** 2025-12

### Context

Transformed code should map back to original source for debugging.

### Decision

Use `magic-string` for source map generation:
- Track all string replacements
- Generate source maps compatible with build tool expectations
- Enable by default, configurable via `sourceMap: false`

### Consequences

- Debugging works correctly in browser devtools
- Stack traces point to original macro locations
- Small performance overhead (acceptable)

---

## ADR-008: Server-Side i18n with Server Actions

**Status:** Accepted
**Date:** 2025-12

### Context

React Server Components (RSC) render once on the server. Language switching is a client-side action. How do we make Server Components re-render with a new locale?

### Decision

Use **Server Actions + `revalidatePath()`** for language switching:

```
┌─────────────────────────────────────────────────────────────┐
│  1. Server reads locale from cookie                         │
│  2. Server initializes i18n with setI18n()                  │
│  3. Server Components use getLingui() → i18n._()            │
│  4. Client Components use useLingui() → reactive _()        │
│  5. Language switch: Server Action sets cookie + revalidates│
│  6. Next.js streams new Server Components to client         │
└─────────────────────────────────────────────────────────────┘
```

**File structure:**
```
src/lib/
  i18n.ts          # Shared: types, LOCALES, loadMessages()
  i18n.server.ts   # Server-only: getLocale(), initI18nServer()
  actions.ts       # Server Action: setLocaleAction()
```

**Server Component:**
```tsx
import { getLingui } from "@lingui/core/macro"
import { initI18nServer } from "@/lib/i18n.server"

export default async function Page() {
  await initI18nServer()
  const { t } = getLingui()
  return <h1>{t`Hello`}</h1>
}
```

**Server Action:**
```tsx
"use server"
import { cookies } from "next/headers"
import { revalidatePath } from "next/cache"

export async function setLocaleAction(locale: string) {
  cookies().set("locale", locale, { path: "/", maxAge: 31536000 })
  revalidatePath("/", "layout")
}
```

**Client Component (Language Switcher):**
```tsx
"use client"
import { useTransition } from "react"
import { setLocaleAction } from "@/lib/actions"

function LanguageSwitcher() {
  const [isPending, startTransition] = useTransition()

  function handleChange(locale: string) {
    startTransition(async () => {
      setLocale(locale)           // Optimistic client update
      await setLocaleAction(locale) // Server: cookie + revalidate
    })
  }
}
```

### How RSC Streaming Works

When `revalidatePath()` is called:
1. Next.js re-renders affected Server Components
2. RSC payload is streamed to client (not full HTML)
3. React reconciles new server output with existing client state
4. Client state (e.g., counter value) is preserved
5. No full page reload, no JavaScript restart

### Alternatives Considered

1. **`router.refresh()`**: Works but less idiomatic than Server Actions
2. **URL-based locale (`/de/...`, `/en/...`)**: More explicit, better for SEO, but requires route restructuring
3. **Full page reload**: Works but loses client state

### Consequences

- ✅ Server Components properly re-render on language change
- ✅ Client state is preserved (RSC streaming)
- ✅ Optimistic UI updates with `useTransition()`
- ✅ Atomic operation (cookie + revalidation in one action)
- ⚠️ Requires `setI18n()` call in server code
- ⚠️ Small delay for server round-trip on language change

---

## ADR-009: pofile-ts as Central PO Library

**Status:** Accepted
**Date:** 2025-12

### Context

Lingui's PO file handling was spread across multiple packages with different implementations:
- `format-po`: Basic PO parsing/serialization
- `format-po-gettext`: Plural handling with `node-gettext`, `plurals-cldr`, `cldr-core`
- Custom `plural-samples.ts` for CLDR sample data

This led to:
- Large dependency footprint
- CSP issues (`new Function()` for plural expressions)
- Inconsistent plural category handling

### Decision

Use [pofile-ts](https://github.com/sebastian-software/pofile-ts) as the single source for all PO operations:

```typescript
import {
  parsePo,
  stringifyPo,
  splitMultilineComments,
  parsePluralFormsHeader,
  getPluralCategories,
  getPluralFunction,
  getPluralSamples,
  catalogToItems,
  itemsToCatalog,
  mergeCatalogs,
} from "pofile-ts"
```

### Benefits

- **Fewer dependencies:** Removed `node-gettext`, `plurals-cldr`, `cldr-core`
- **CSP-safe:** Standard plural expressions parsed without `eval()`
- **Complete CLDR data:** All plural categories including `many` for ru, uk, fr, es, etc.
- **Unified API:** Same library for parsing, serialization, and catalog operations

### Consequences

- Single dependency for all PO operations
- ~264 lines of code removed from Lingui
- Correct plural handling for all CLDR-supported languages

---

## ADR-010: OXC-based Message Extraction

**Status:** Accepted
**Date:** 2025-12

### Context

Lingui's Babel-based extractor is slow and requires complex configuration. The extraction process is a bottleneck in large codebases.

### Decision

Implement OXC-based extraction with two packages:

**`@palamedes/extractor`** (extractor-oxc):
```typescript
import { oxcExtractor } from "@palamedes/extractor"

// Use in lingui.config.ts
export default {
  extractors: [oxcExtractor],
}
```

**`@palamedes/cli`** (cli):
```bash
palamedes extract --watch --verbose
```

### Architecture

```
┌─────────────────────────────────────────┐
│  @palamedes/cli                         │
│  (extract command, watch mode)          │
├─────────────────────────────────────────┤
│  @palamedes/extractor                   │
│  (oxcExtractor, extractMessages)        │
├─────────────────────────────────────────┤
│  oxc-parser + pofile-ts                 │
└─────────────────────────────────────────┘
```

### Features

- **~20-100x faster** than Babel-based extraction
- **Watch mode** with chokidar
- **Direct PO output** via pofile-ts
- **Preserves translations** when merging

### Consequences

- Extraction is no longer a bottleneck
- Simpler configuration (no Babel plugins needed)
- Can run as standalone CLI or integrate with existing Lingui config

---

## Future Decisions (Pending)

- [ ] Hot module replacement behavior
- [ ] TypeScript type generation for message catalogs
