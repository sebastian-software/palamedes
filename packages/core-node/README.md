# @palamedes/core-node

Thin Node.js wrapper around the Palamedes Rust core.

This package provides the JavaScript wrapper around the Palamedes native bindings.

The actual `.node` binary is delivered through platform-specific optional dependencies:

- `@palamedes/core-node-darwin-arm64`
- `@palamedes/core-node-linux-x64-gnu`
- `@palamedes/core-node-linux-arm64-gnu`
- `@palamedes/core-node-win32-x64-msvc`

## Available APIs

- `getNativeInfo()`
- `generateMessageId(message, context?)`
- `parsePo(source)`

## Development

```bash
pnpm --filter @palamedes/core-node build
```

In development, build the matching native target package for your current platform before using this wrapper.
