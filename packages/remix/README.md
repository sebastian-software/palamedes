# @palamedes/remix

Experimental Remix v3 integration for Palamedes.

Use this package with Remix v3's default Node loader path. Register Remix's TSX
loader first, then Palamedes:

```sh
node --import remix/node-tsx --import @palamedes/remix/register server.ts
```

The register hook composes with `remix/node-tsx`, receives the JavaScript source
that Remix compiled from `.ts` and `.tsx` files, and runs the Palamedes macro
transform before Node executes the module.

## Scope

This first integration supports JavaScript macros such as `t`, `msg`, `plural`,
`select`, `selectOrdinal`, and `defineMessage` in server-loaded Remix modules.

Rich JSX message macros are still experimental for Remix v3 because Remix's
loader lowers JSX to `remix/ui/jsx-runtime` calls before this hook runs.

## License

[![Sebastian Software](https://sebastian-brand.vercel.app/sebastian-software/logo-software.svg)](https://oss.sebastian-software.com/)

MIT © 2026 Sebastian Software
