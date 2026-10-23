# Intlayer 9.7.0 Catalog Roundtrip Conformance

This untimed smoke check compares both supported dictionary formats. It uses the same generated components and catalog inventory as the workflow benchmark. The TypeScript path is inspected through Intlayer's own built unmerged JSON artifacts; source dictionary entries are seeded by TypeScript AST positions.

| Framework | Dictionary format | Current messages | Written messages | Existing translations retained | Result |
| --- | --- | ---: | ---: | --- | --- |
| vue | .content.json | 32 | 35 | 17/25 | not-equivalent |
| vue | .content.ts | 32 | 35 | 25/25 | not-equivalent |
| svelte | .content.json | 32 | 35 | 17/25 | not-equivalent |
| svelte | .content.ts | 32 | 35 | 25/25 | not-equivalent |
| solid | .content.json | 32 | 35 | 17/25 | not-equivalent |
| solid | .content.ts | 32 | 35 | 25/25 | not-equivalent |

Both formats retain removed entries in this fixture. The TypeScript format preserves the unchanged translations, while the JSON format loses the interpolated translations. This is a version/configuration-specific conformance result, not a timing or a claim about every Intlayer workflow.

```sh
pnpm --dir benchmarks/e2e-workflow/frameworks diagnose:intlayer
```
