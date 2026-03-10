# ADR-003: `useLingui()` vs `getLingui()` Macros

**Status:** Superseded by ADR-014
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

### Superseded

This ADR reflected the earlier Lingui-compatible split between hook-like and direct-access macros.
Palamedes now prefers a single runtime primitive, `getI18n()`. See ADR-014.

---
