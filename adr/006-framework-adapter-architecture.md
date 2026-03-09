# ADR-006: Framework Adapter Architecture

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
