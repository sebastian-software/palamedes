# @palamedes/core-node

Thin Node.js wrapper around the Palamedes Rust core.

This package is the first migration spike for the Rust-core architecture. It currently exposes a minimal API surface to validate:

- Cargo workspace integration
- published `pofile` crate usage from Rust
- Node native bindings loading from a TypeScript wrapper

## Available APIs

- `getNativeInfo()`
- `generateMessageId(message, context?)`
- `parsePo(source)`

## Development

```bash
pnpm --filter @palamedes/core-node build
```

The build script compiles the Rust binding crate and copies the resulting native module into the package root as `palamedes-node.node`.
