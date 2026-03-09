# ADR-001: Standalone Repository

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
