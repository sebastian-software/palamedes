# Spike: Remix v3 Support

**Status:** Spike complete
**Date:** 2026-07-06
**Issue:** https://github.com/sebastian-software/palamedes/issues/284

## Summary

Remix v3 support looks feasible. The quickest useful integration path is a
Node `--import` registration module that composes with Remix's own
`remix/node-tsx` loader and runs Palamedes' existing native macro transform.

The first proof covered server-side JS macros in a real Remix v3 beta scaffold.
It did not yet solve the full UI adapter, PO catalog loading, or JSX-rich
message components.

## Current Remix v3 Shape

Verified against `remix@next` on 2026-07-06:

- `remix@next` resolved to `3.0.0-beta.5`.
- `npx remix@next new` equivalent CLI shape is `remix new <target-dir>
[--app-name <name>] [--force]`.
- The generated app uses `node --import remix/node-tsx server.ts` for both
  development and production scripts.
- The scaffold requires Node `>=24.3.0`.
- `remix/node-tsx` registers a synchronous `node:module` load hook via
  `registerHooks({ load })`.
- App modules are plain file imports under `app/`, with `server.ts`,
  `app/router.ts`, `app/actions/controller.tsx`, and server rendering through
  `remix/ui/server`.

This matches the issue's core assumption: the default Remix v3 path is not a
Vite pipeline, so the adapter should not start as a Vite-only integration.

## Proof

Scratch scaffold:

```sh
pnpm dlx remix@next new /private/tmp/palamedes-remix-v3-spike \
  --app-name palamedes-remix-v3-spike \
  --force
```

Built the minimum Palamedes transform chain in the spike worktree:

```sh
pnpm --filter @palamedes/transform... build
```

Added a temporary `palamedes-register.mjs` loader that:

1. registers `node:module` `load`
2. delegates to `nextLoad()` so Remix's `node-tsx` hook compiles TS/TSX
3. runs `transformPalamedesMacros()` on returned JS source
4. returns the transformed source to Node

Then added a temporary Remix module:

```ts
import { t } from "@palamedes/core/macro"

export function renderGreeting(name: string) {
  return t`Hello ${name} from Remix 3`
}
```

Smoke command:

```sh
node --import remix/node-tsx --import ./palamedes-register.mjs proof.mjs
```

Result:

```text
Hello Ada from Remix 3
```

Control command without the Palamedes hook:

```sh
node --import remix/node-tsx proof.mjs
```

Result: failed with the expected macro-stub error from
`@palamedes/core/macro`, confirming the hook caused the transform.

HTTP smoke:

```sh
PORT=44107 node --import remix/node-tsx --import ./palamedes-register.mjs server.ts
curl -i http://127.0.0.1:44107/
```

Result:

```text
HTTP/1.1 200
x-palamedes-proof: Hello Ada from Remix 3
```

## Recommended First Implementation

Ship a small `@palamedes/remix` package with a register subpath:

```sh
node --import remix/node-tsx --import @palamedes/remix/register server.ts
```

The first version should support:

- JS macro transforms for `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, and `.cjs`
- configurable `runtimeModule`, defaulting to `@palamedes/runtime`
- clear macro-stub errors when the register hook is missing or ordered wrong
- tests that exercise hook composition with a fixture equivalent to the Remix
  scaffold

Keep the Vite plugin as a possible shortcut only for non-default Remix setups.
It should not be the primary Remix v3 story.

## Open Work

JSX-rich macros are the main unresolved part. The quick proof transforms after
Remix's `node-tsx` has compiled JSX to `remix/ui/jsx-runtime` calls. That is
fine for `t`, `msg`, `plural`, `select`, and `defineMessage`, but it is probably
too late for `<Trans>`-style source JSX unless the native transform can support
the lowered call shape.

Likely follow-up choices:

1. Run Palamedes before Remix's JSX transform, then hand the transformed source
   to the same OXC TSX transform behavior. This may require owning more of the
   loader pipeline.
2. Teach the native transformer to recognize Remix-lowered JSX runtime calls for
   rich messages. This is more adapter-specific.
3. Start Remix v3 support with JS macros plus server locale wiring, then add
   rich JSX messages once the component model settles.

The pragmatic route is option 3 for an early beta demo, with the register hook
and middleware first.

## Risks

- Remix v3 beta APIs are still unstable. Pin the demo to an exact beta.
- The package currently depends on Node `>=24.3.0` through Remix's default
  loader path.
- `pnpm install` in the scratch scaffold hit pnpm's ignored-build policy for
  `esbuild`; the server path still worked for this smoke, but a full demo may
  need explicit build-script approval or a checked-in lockfile policy.
- `remix routes` triggered Remix's dependency-status check, which attempted
  `pnpm install` and failed without TTY in this environment. Use direct Node
  smoke tests in CI until that path is understood.

## Verdict

Machbar. The narrow first PR should be an experimental register hook plus a
minimal Remix v3 fixture proving JS macros and request-scoped server runtime
setup. A full adapter/demo PR should follow only after deciding how much
`<Trans>`/rich text support is required for the first public claim.
