# `@palamedes/solid`

`@palamedes/solid` mirrors the React package for Solid applications.

## Exports

- `Trans`
- `Plural`
- `Select`
- `SelectOrdinal`
- `buildLocaleSwitchItems(options)`
- `TransProps`
- `PluralProps`
- `SelectProps`
- `SelectOrdinalProps`
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

The transform rewrites `Trans` to `@palamedes/solid/compiled`. That subpath
exports the compiled-message `Trans` adapter without importing Core's ICU
parser. The package root remains the full runtime-component compatibility
surface.

## Runtime Components

Runtime components read the active i18n instance through the plain
`@palamedes/runtime` getter. They do not install signal dependencies for locale
changes; changing locale requires a document navigation.

```tsx
import { Trans } from "@palamedes/solid"
;<Trans id="title" message="Welcome to Palamedes" />
```

For source authoring, prefer macro imports from `@palamedes/solid/macro`.

## Choice Components

`Plural`, `Select`, and `SelectOrdinal` take the branch text as props: plural
categories (`zero`, `one`, `two`, `few`, `many`, `other`) and exact matches
spelled `_0`, `_1`, … because a JSX attribute cannot start with `=`. Exact
matches are normalized to ICU `=N`, mirroring the macro transform. `other` is
required.

`Plural` and `SelectOrdinal` also accept `offset`, the ICU `offset:N` of the
synthesized pattern, for "and N others" sentences where the number shown is
smaller than the number counted:

```tsx
<Plural value={attendees()} offset={1} _0="nobody else" one="# other" other="# others" />
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
// app.config.ts
palamedes({ framework: "solid" })
```

Macro `t` / `plural` calls still use the same framework-neutral, hook-free
runtime getter. See `docs/locale-strategies.md` for document navigation and the
unsupported root-key escape hatch.
