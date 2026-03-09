# ADR-009: pofile-ts as Central PO Library

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
