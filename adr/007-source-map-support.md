# ADR-007: Source Map Support

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
