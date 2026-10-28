# `@palamedes/solid`

`@palamedes/solid` mirrors the React package for Solid applications.

> **Breaking minor release at `1.18.0`:** `@palamedes/solid` moved from Solid 1
> to Solid 2 while Palamedes packages continued their lockstep `1.x` releases.
> A dependency range such as `^1.17.3` can therefore upgrade a Solid 1 app to a
> Solid 2 adapter and lose Solid 1 compatibility. If your app must stay on
> Solid 1, pin `@palamedes/solid` to `1.17.3`, the last Solid 1-compatible
> release. To use a newer adapter, migrate the app and its compiler/tooling to
> Solid 2 first; `@palamedes/solid` `1.18.0` and newer target Solid 2.

## Verified Solid 2 setup

The four app examples use Solid 2 with the Solid Vite plugin's **Start Mode**
and Nitro v3. Their tested versions are `solid-js` and `@solidjs/web`
`2.0.0-rc.16`, `@solidjs/vite-plugin@3.0.0-next.50`,
`@solidjs/router@2.0.0-next.41`, and `filesystem-routing@0.4.0`.
The package requires `solid-js@^2.0.0-rc.16`. This verifies Start Mode; the
separate Solid Start host still needs its own integration verification.

Start Mode middleware receives `(event, next)`. The generic catalog helper
continues to accept a `Request`, so bridge it explicitly:

```ts
import type { StartMiddleware } from "@solidjs/vite-plugin";
import { createSolidCatalogDeliveryMiddleware } from "@palamedes/solid/server";

const catalogDelivery = createSolidCatalogDeliveryMiddleware({
  resolveLocale: (request) => resolveLocale(request),
});

export default [
  (event, next) => catalogDelivery(event.request, next),
  // Follow with the app's request-local i18n scope before rendering.
] satisfies StartMiddleware[];
```

`palamedes()` adds `@palamedes/runtime` and `@palamedes/vite-plugin` to
`ssr.noExternal` and to every other server environment itself, so their
virtual catalog imports stay in Vite's module graph without extra config. The
plugin's generated entries handle SSR and hydration; use Solid's public
`Errored` and `Loading` components for error and loading boundaries.

`clientDirectory` defaults to Nitro's `.output/public` in the process working
directory, and `manifestName` overrides the generated manifest filename, as in
the other Vite-based adapters. `development` defaults to how Vite built the
server (`import.meta.env.DEV`): `true` under `vite dev`, `false` in the output of
`vite build`. The runtime `NODE_ENV` does not change it, so a production build
served without `NODE_ENV` still delivers the import map. In development the
helper reads no manifest; pass `development` to override the default. The helper has no `i18nOptions` or
`failureMessage`: the application's own middleware creates the request
instance, for example with `createBundledServerI18n({ locale, timeZone })`.

For a nonce-based CSP, give the catalog helper the host's trusted request nonce
as a string or a `(request) => string | undefined` resolver, called once per
HTML document. Start Mode's Fetch middleware has no context object to pass, so
the resolver receives only the request. Set `event.nonce` to that same value
before `next()`. Start Mode forwards
it to the renderer. Custom Documents must also pass the script nonce from
`getRequestEvent()?.nonce` to `HydrationScript`. See the
[Solid package guide](https://github.com/sebastian-software/palamedes/tree/main/packages/solid#ssr-and-split-catalogs)
and the [cookie example](https://github.com/sebastian-software/palamedes/tree/main/examples/solid-cookie)
for the complete wiring.

## Exports

- `Trans`
- `buildLocaleSwitchItems(options)`
- `TransProps`
- `BuildLocaleSwitchItemsOptions`
- `LocaleSwitchItem`

The locale-switch helper and related types are re-exported from
`@palamedes/core/locale`.

The macro subpath `@palamedes/solid/macro` exports compile-time macro
components:

- `Trans`
- `Plural`
- `Select`
- `SelectOrdinal`

The transform rewrites `Trans` to `@palamedes/solid/compiled`. In v2, the
package root and the `/compiled` alias resolve to the same parser-free compiled
runtime. The alias remains useful for explicit macro targets; it is not a parser-
enabled compatibility mode. Hand-written components that still depend on raw
ICU parsing must migrate to compiled messages.

## Runtime component

The package root exports the parser-free runtime `Trans` component. It reads the
active i18n instance through the plain `@palamedes/runtime` getter and does not
install signal dependencies for locale changes; changing locale requires a
document navigation.

Author messages with the macro from `@palamedes/solid/macro`:

```tsx
import { Trans } from "@palamedes/solid/macro";

<Trans>Welcome to Palamedes</Trans>;
```

The transform replaces the macro with the runtime `Trans` from
`@palamedes/solid` and injects `id`, the compiled lookup key the runtime
component requires. Do not write runtime `Trans` elements by hand: `message` is
optional diagnostic metadata and is never used as a lookup key.

## Choice macros

`Plural`, `Select`, and `SelectOrdinal` are compile-time components. Import
them from `@palamedes/solid/macro`; they are transformed into the parser-free
runtime before the application runs. The package root does not export choice
components or a runtime parser for hand-written choice trees.

Choice macros take branch text as props: plural categories (`zero`, `one`,
`two`, `few`, `many`, `other`) and exact matches spelled `_0`, `_1`, … because
a JSX attribute cannot start with `=`. Exact matches are normalized to ICU
`=N`, mirroring the macro transform. `other` is required.

Each branch must be a string literal or a template literal, either as a plain
attribute (`one="# item"`) or inside braces (``one={`# item for ${name}`}``).
Extraction and the transform reject any other branch value, such as a constant,
a member expression, a JSX element, or a nested `t`, `plural`, `select`, or
`<Trans>`, with an error that names the branch and its source location.
Spread attributes such as `{...props}` fail with a located error as well, since
their branches are only known at runtime.

`Plural` and `SelectOrdinal` also accept `offset`, the ICU `offset:N` of the
synthesized pattern, for "and N others" sentences where the number shown is
smaller than the number counted:

```tsx
import { Plural } from "@palamedes/solid/macro";

<Plural value={attendees()} offset={1} _0="nobody else" one="# other" other="# others" />;
```

- exact `_N` / `=N` keys match the **raw** value, before the offset is
  subtracted
- plural categories select on `value - offset`
- `#` inside a branch renders `value - offset`

`offset` must be a non-negative safe integer; anything else throws a
`RangeError` rather than rendering a wrong count. `Select` has no numeric
operand and takes no `offset`.

## Framework Selection

Set the framework only so generated MDX uses Solid's component contract:

```ts
// vite.config.ts
palamedes({ framework: "solid" });
```

Macro `t` / `plural` calls still use the same framework-neutral, hook-free
runtime getter. See `docs/locale-strategies.md` for document navigation and the
unsupported root-key escape hatch.
