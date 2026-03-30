# `@palamedes/solid`

Use this package when your app wants Solid-native translation components such as
`Trans`, `Plural`, `Select`, and `SelectOrdinal`.

Palamedes keeps the runtime model provider-free. Transformed code resolves the
active i18n instance through `getI18n()` from
[`@palamedes/runtime`](https://github.com/sebastian-software/palamedes/tree/main/packages/runtime),
so your Solid app only needs to register the active client or server instance
before translated code runs.

This package is part of the verified SolidStart story in the example matrix. It
shares the same catalog model, runtime semantics, and Vite plugin path as the
React integrations while swapping only the thin JSX adapter layer.

## Install

```bash
pnpm add @palamedes/core @palamedes/solid @palamedes/runtime
pnpm add -D @palamedes/vite-plugin @palamedes/cli @palamedes/config vite-plugin-solid
```

## Example

```tsx
import { Trans } from "@palamedes/solid/macro"

export function Footer() {
  return (
    <footer>
      <Trans>Powered by Palamedes</Trans>
    </footer>
  )
}
```

When the Palamedes transform runs, macro imports are rewritten to runtime
imports from `@palamedes/solid`.

## Related Docs

- [First working translation in 5 minutes](https://github.com/sebastian-software/palamedes/blob/main/docs/first-working-translation.md)
- [Example matrix](https://github.com/sebastian-software/palamedes/blob/main/examples/README.md)
- [Proof and benchmarks](https://github.com/sebastian-software/palamedes/blob/main/docs/proof-and-benchmarks.md)
