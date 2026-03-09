# ADR-002: OXC over Babel/SWC for Macro Transformation

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
