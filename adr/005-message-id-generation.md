# ADR-005: Message ID Generation

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

- Single implementation across all packages (format-po, format-po-gettext, babel-plugin-lingui-macro, transform, extractor)
- 8-character IDs are more collision-resistant than previous 6-character IDs
- No external crypto dependencies (uses Web Crypto API)

---
