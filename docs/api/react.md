# `@palamedes/react`

`@palamedes/react` provides provider-free React runtime components, macro entry
points, and headless locale-switch helpers.

## Exports

- `Trans`
- `buildLocaleSwitchItems(options)`
- `Fragment`
- `TransProps`
- `BuildLocaleSwitchItemsOptions`
- `LocaleSwitchItem`

`Fragment` is re-exported from React for generated/runtime component rendering
paths that need the same import surface as other React helpers.

The locale-switch helper and related types are re-exported from
`@palamedes/core/locale`.

The macro subpath `@palamedes/react/macro` exports compile-time macro
components:

- `Trans`
- `Plural`
- `Select`
- `SelectOrdinal`

The transform rewrites `Trans` to `@palamedes/react/compiled`. In v2, the
package root and the `/compiled` alias resolve to the same parser-free compiled
runtime (including the `react-server` condition). The alias remains useful for
explicit macro targets; it is not a parser-enabled compatibility mode. Hand-
written components that still depend on raw ICU parsing must migrate to compiled
messages.

## Runtime Components

Runtime components read the plain active runtime getter. They do not install
external-store subscriptions or update independently after an i18n-instance
replacement; changing locale requires a document navigation.

Author rich text with the macro from `@palamedes/react/macro`:

```tsx
import { Trans } from "@palamedes/react/macro";

<Trans>
  Powered by <strong>Palamedes</strong>
</Trans>;
```

The transform replaces the macro with the runtime `Trans` from
`@palamedes/react` and injects `id`, the compiled lookup key the runtime
component requires. Do not write runtime `Trans` elements by hand: `message` is
optional diagnostic metadata and is never used as a lookup key.

## Choice macros

`Plural`, `Select`, and `SelectOrdinal` are compile-time components. Import
them from `@palamedes/react/macro`; they are transformed into the parser-free
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
their branches are only known at runtime. The macro components are JSX-only:
`createElement(Plural, …)` and `React.createElement(Plural, …)` fail with a
located error, and so does `Trans`; write the element as JSX or use the
matching function macro.

`Plural` and `SelectOrdinal` also accept `offset`, the ICU `offset:N` of the
synthesized pattern. Use it for "and N others" sentences where the number shown
is smaller than the number counted:

```tsx
import { Plural } from "@palamedes/react/macro";

<Plural value={attendees} offset={1} _0="nobody else" one="# other" other="# others" />;
```

- exact `_N` / `=N` keys match the **raw** value, before the offset is
  subtracted
- plural categories select on `value - offset`
- `#` inside a branch renders `value - offset`

`offset` must be a non-negative safe integer; anything else throws a
`RangeError` rather than rendering a wrong count. `Select` has no numeric
operand and takes no `offset`.

The components render through the active i18n instance, so the synthesized ICU
pattern — including `offset:N` — is the source message a catalog entry can
override.

## Locale Switch Helpers

```ts
import { buildLocaleSwitchItems } from "@palamedes/react";

const items = buildLocaleSwitchItems({
  currentLocale: "de",
  labels: { de: "Deutsch", en: "English" },
  locales: ["en", "de"],
});
```

Supported host adapters initialize the client runtime and deliver compiled
active-locale dependencies automatically. The v1 client boundary
`@palamedes/react/client` is removed; see the
[v2 migration guide](../migration-v2.md).
