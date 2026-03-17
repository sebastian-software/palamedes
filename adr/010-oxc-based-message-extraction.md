# ADR-010: OXC-based Message Extraction

**Status:** Accepted
**Date:** 2025-12

### Context

Lingui's Babel-based extractor is slow and requires complex configuration. The extraction process is a bottleneck in large codebases.

### Decision

Implement OXC-based extraction with two packages:

**`@palamedes/extractor`** (extractor):
```typescript
import { extractor } from "@palamedes/extractor"

// Use in lingui.config.ts
export default {
  extractors: [extractor],
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
│  (extractor, extractMessages)           │
├─────────────────────────────────────────┤
│  native Palamedes core + ferrocat       │
└─────────────────────────────────────────┘
```

### Features

- **~20-100x faster** than Babel-based extraction
- **Watch mode** with chokidar
- **Direct catalog updates** via native Rust workflows backed by `ferrocat`
- **Preserves translations** when merging

### Consequences

- Extraction is no longer a bottleneck
- Simpler configuration (no Babel plugins needed)
- Can run as standalone CLI or integrate with existing Lingui config

---

## Future Decisions (Pending)

- [ ] Hot module replacement behavior
- [ ] TypeScript type generation for message catalogs

---
