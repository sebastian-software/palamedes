# ADR-004: `<Trans>` Always Transforms to React Component

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
