import assert from "node:assert/strict";
import { test } from "node:test";
import { buildProgressiveOutlineItems } from "./progressive-outline.mjs";

test("progressive outlines share Ardo 6's native heading identities", () => {
  const items = buildProgressiveOutlineItems(`## What's included?

## Repeated heading

### Repeated heading

## Repeated heading

\`\`\`md
## A code example is not a section
\`\`\`
`);
  assert.deepEqual(items, [
    { id: "what-s-included", text: "What's included?", depth: 2 },
    { id: "repeated-heading", text: "Repeated heading", depth: 2 },
    { id: "repeated-heading-2", text: "Repeated heading", depth: 2 },
  ]);
});
