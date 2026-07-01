# RFC: Headless Locale Controls in the Library

**Status:** Draft / Proposed
**Date:** 2026-07-01
**Owner:** Palamedes maintainers

## Summary

Palamedes should offer the *behavior* of choosing and switching a locale —
resolution, the deliberate-choice cookie, and the suggestion banner logic — as
an optional, headless part of the public library, next to `t` / `Trans`.

Today this mechanism is fully implemented but lives in the **private**
`@palamedes/example-locale-shared` package, so every demo (and every real user)
that wants a locale switcher plus a "you may prefer German" hint has to rebuild
the same wheel. The one piece that *is* already public — `buildLocaleSwitchItems`
in `@palamedes/react` and `@palamedes/solid` — proves the intended shape:
Palamedes hands over **data and decisions**, the user renders the UI.

The proposal is to lift the generalizable, framework-agnostic logic into a
public, configurable surface — shipped as the **`@palamedes/core/locale`**
subpath, not a new package — with any framework additions as thin, optional
re-exports, and all opinionated UI and router wiring kept out of the library.

## Motivation

- **The wheel gets re-invented.** Locale resolution (cookie / Accept-Language /
  route / host), the `locale-choice` cookie, and the suggestion decision are
  generic. Every app needs roughly the same thing.
- **It already exists, just privately.** `example-locale-shared` is a working,
  tested implementation. It is marked `"private": true` and hardcodes the demo's
  `LOCALES`, cookie names, and host map.
- **A headless precedent is set.** `buildLocaleSwitchItems` already ships
  publicly and headlessly in both framework packages. Extending that contract is
  natural, not a new paradigm.

## Goals

- Expose locale **resolution**, **choice recording**, and **suggestion**
  decisions as public, configurable API.
- Stay **headless**: return data and decisions; never impose markup or styles.
- Make everything **configurable**: locales, default, labels, cookie names, host
  map, and strategy are parameters — nothing hardcoded.
- Keep it **opt-in and tree-shakeable**: a user who only wants `t` / `Trans`
  must not pull locale-control code.
- **Dogfood** by migrating the example matrix onto the public API, shrinking or
  removing `example-locale-shared`.

## Non-goals

- **No styled components.** No `<LocaleSwitcher>` / `<SuggestionBanner>` with
  built-in CSS in the core. At most optional, unstyled recipes or a separate
  `-ui` package later.
- **No router abstraction.** `next/link`, Solid's `<A>`, Waku `Link`, TanStack
  `Link` are too different to wrap. The library says *which* locale and *which*
  target URL; the user wires their own router. This is the hard boundary and
  the reason the current switchers stay framework-local.
- **No change to `t` / `Trans` / extraction.** This is additive.

## Current state

Public (headless) today:

- `@palamedes/react` and `@palamedes/solid`: `buildLocaleSwitchItems`,
  `LocaleSwitchItem`, `BuildLocaleSwitchItemsOptions` (duplicated per framework).

Private today (`@palamedes/example-locale-shared`, would be generalized):

- Constants/types: `DEFAULT_LOCALE`, `LOCALES`, `LOCALE_COOKIE`,
  `LOCALE_CHOICE_COOKIE`, `Locale`, `LocaleSource`, `HostLocaleConfig`,
  `LocaleBanner`, `LOCALE_LABELS`.
- Predicates/labels: `isLocale`, `normalizeLocale`, `getLocaleLabel`.
- Parsing: `parseAcceptLanguage`, `getPreferredLocale`, `parseCookieLocale`,
  `parseChoiceLocale`, `serializeChoiceCookie`.
- Resolution: `resolveCookieLocale`, `resolveRouteLocale`, `resolveHostLocale`.
- URLs: `replaceLocaleInPath`, `extractLocaleFromPath`, `getCanonicalHost`,
  `buildCanonicalUrl`, `stripPort`, `getPort`.
- Suggestion: `createRouteLocaleBanner`.

## Proposed design

### Principles

1. Headless — data and decisions only.
2. Configurable — a single config object threads locales, default, labels,
   cookie names, and host map through every function.
3. Framework-agnostic core; thin framework hooks; no UI.
4. Opt-in via a dedicated entry point.

### Package layout (decided)

The core logic ships as a subpath of `@palamedes/core`: **`@palamedes/core/locale`**.

Rationale: the logic is ~305 lines of pure TypeScript with **no imports and no
(peer)dependencies** — entirely framework-agnostic. `@palamedes/core` already
exposes subpath exports (`.`, `./macro`), so `./locale` slots in with zero
packaging overhead, stays opt-in and tree-shakeable, and rides core's release.
`@palamedes/react` / `@palamedes/solid` already depend on `@palamedes/core`, so
they can consume it directly.

A dedicated `@palamedes/locale` package was considered and **rejected**: the
publishing, versioning, and CI overhead is not justified for ~300 lines of
dependency-free code, and core is already the framework-agnostic base.

Any framework additions live on a `/locale` subpath of the framework packages so
the base import stays lean.

### Configuration

Everything hardcoded in the demo becomes a config object created once:

```ts
type LocaleControlsConfig<L extends string> = {
  locales: readonly L[]
  defaultLocale: L
  labels?: Partial<Record<L, string>>          // else Intl.DisplayNames
  cookies?: { locale?: string; choice?: string } // default "locale" / "locale-choice"
  hosts?: HostLocaleConfig<L>                    // optional host strategy
}

const locales = defineLocaleControls({
  locales: ["en", "de", "es"],
  defaultLocale: "en",
})
```

### Framework-agnostic core surface (sketch)

```ts
// resolution — from request headers, per strategy
locales.resolve({ strategy: "cookie" | "route", headers, routeLocale? })
  : { locale: L; source: LocaleSource }

// deliberate choice cookie
locales.readChoice(cookieHeader): L | null
locales.serializeChoice(locale: L): string        // for document.cookie

// suggestion decision (UI-agnostic; today's createRouteLocaleBanner)
locales.suggest({ currentLocale, headers, pathname, routeLocale? })
  : { reason: "accept-language" | "host"; recommendedLocale: L; recommendedUrl: string } | null

// url helpers
locales.canonicalUrl({ locale, pathname, requestHost?, search? }): string
```

`suggest()` keeps this RFC's core rule: prefer `choice ?? Accept-Language`, so a
deliberate decision silences the hint while an unintended landing still informs
once; host mismatches are independent.

### Framework layer (thin, mostly optional)

`buildLocaleSwitchItems` is pure (`locales.map(...)`); its logic moves to
`@palamedes/core/locale` and the framework packages **re-export** it, removing
today's duplication between `@palamedes/react` and `@palamedes/solid`.

Beyond that, the framework layer is optional convenience, not required:

```ts
// @palamedes/react/locale  (and @palamedes/solid/locale) — OPTIONAL

recordLocaleChoice(locales, locale)   // one-liner: document.cookie = serializeChoice(...)
useLocaleSuggestion(suggestion)       // { dismissed, dismiss(), acceptTo(url) }
```

`recordLocaleChoice` is a trivial wrapper over the core `serializeChoice`, and
`useLocaleSuggestion` owns only dismiss state. A user can skip both — call the
core functions directly and hold the dismiss flag in their own
`useState` / `createSignal`. The switcher itself always stays user-rendered: map
`buildLocaleSwitchItems()` onto your router's links and record the choice on
click.

## Migration path

1. Land `@palamedes/core/locale` with full unit tests ported from
   `example-locale-shared`.
2. Add the framework `/locale` hooks.
3. Migrate the example matrix to consume the public API (dogfood); delete the
   generalizable parts of `example-locale-shared`, leaving only demo-specific
   content (e.g. the fictional event data, which stays in `example-ui`).
4. Document under `docs/locale-strategies.md` and a short "locale controls"
   guide.

## Decided

- **Package layout:** `@palamedes/core/locale` subpath. A dedicated
  `@palamedes/locale` package is rejected — packaging/versioning/CI overhead is
  unjustified for ~300 lines of dependency-free logic.
- **`buildLocaleSwitchItems` home:** move the pure logic to
  `@palamedes/core/locale`; `@palamedes/react` / `@palamedes/solid` re-export it,
  removing today's duplication.
- **Framework hooks:** optional convenience only; a user can rely on the core
  functions plus their own trivial dismiss state.

## Open questions

- **Naming:** `suggest()` / `LocaleSuggestion` vs. keeping "banner" wording.
- **How far on UI:** ship nothing, ship unstyled recipes in docs, or a separate
  optional `-ui` package?
- **Host strategy scope:** is host-based locale worth generalizing now, or keep
  it demo-only initially?

## Out of scope

- Styled/opinionated components in core.
- Router navigation abstraction.
- Any change to message extraction, `t`, or `Trans`.
