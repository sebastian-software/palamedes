# Locale Strategies In The Example Matrix

The example matrix proves four authoritative locale strategies — cookie, route,
subdomain, and tld — plus one derived host mapping behavior on top of the route
strategy.

## Cookie Strategy

Cookie examples follow this rule set:

- if no locale cookie is present, the server picks the best supported locale
  from `Accept-Language`
- once the locale cookie exists, the cookie is authoritative
- there is no recurring mismatch banner once the cookie strategy has an
  explicit cookie value
- locale switches update the cookie and the next request renders with that
  locale

This is the verified path for apps that do not encode locale in the URL.

## Route Strategy

Route examples use a mandatory locale prefix:

- `/:locale/...`

Route examples follow this rule set:

- the locale in the URL is authoritative
- `Accept-Language` is advisory, not authoritative
- if the browser prefers another supported locale, the page shows a small info
  bar with a switch CTA
- unsupported locale values fall back to the default locale in app-specific
  framework code

This is the verified path for SEO-oriented or shareable locale URLs.

## Domain And Host Mapping

Domain-based locale selection is modeled as an extension of the route strategy.

The examples treat host mapping as:

- a host-to-locale map such as `de.lvh.me` -> `de`
- an additional validation signal on top of `/:locale/...`
- a source of mismatch hints, not an automatic redirect

When host mapping disagrees with the rendered locale, the example shows the same
info bar used for `Accept-Language` mismatches, but the CTA points to the
canonical host plus path for the recommended locale.

## Subdomain Strategy

Subdomain examples make the leftmost DNS label authoritative for the locale:

- `de.<app>-subdomain.examples.palamedes.dev` -> `de`

Subdomain examples follow this rule set:

- the leftmost host label is authoritative, resolved by
  `resolve({ strategy: "subdomain", requestHost })`; there is no `/:locale/...`
  path prefix
- `Accept-Language` is advisory, not authoritative: if the browser prefers
  another supported locale, the page shows the same info bar with a switch CTA
- an unknown or missing leftmost label falls back to the best `Accept-Language`
  match, then the default locale
- switching locale loads a different host (the control swaps the leftmost label
  via `canonicalUrl`), so it is always a full document load — the live switching
  mechanism below does not apply

This is distinct from the host mapping above. Host mapping is a _validation
signal on top of_ the route strategy, matched against fully configured per-locale
hosts. The subdomain strategy is a third _authoritative_ resolution source
alongside cookie and route, and needs no per-locale host map: the same
`hosts: { mode: "subdomain" }` configuration works unchanged across `lvh.me`
locally and `*.examples.palamedes.dev` in production, because the locale is read
from the label rather than compared to a fixed host.

## TLD Strategy

TLD examples make the top-level domain (the rightmost DNS label) authoritative
for the locale:

- `<app>.palamedes-i18n.de` -> `de`
- `<app>.palamedes-i18n.fr` -> `fr`
- `<app>.palamedes-i18n.com` -> fallback (not authoritative)

TLD examples follow this rule set:

- the tld is resolved by `resolve({ strategy: "tld", requestHost })`, three-tiered:
  1. a tld label that already _is_ a supported locale is authoritative
     automatically (`.de` -> `de`, `.es` -> `es`, `.fr` -> `fr`), because the
     country code equals the language code
  2. a tld whose label is not a language code is authoritative only when listed
     in the `tld` map (`hosts: { mode: "tld", tld: { at: "de", uk: "en" } }`)
  3. anything else is deliberately not authoritative and falls back to the best
     `Accept-Language` match (region tags expand, so `de-CH` yields `de`), then
     the default locale
- there is no `/:locale/...` path prefix; the locale lives in the domain
- switching locale swaps the top-level domain (the control swaps the rightmost
  label via `canonicalUrl`), so it is always a full document load. The default
  locale has no authoritative tld of its own and switches to `defaultTld`
  (`hosts: { mode: "tld", defaultTld: "com" }`, so `en` -> `.com`), which then
  renders `en` through the fallback above

### Why `.com` and `.ch` are not authoritative

Unlike the subdomain label — which the operator fully controls, so the label can
simply _be_ the locale — real top-level domains carry meaning the app does not
own. `.com` is generic and maps to no single language, so it is left unmapped and
serves the default locale through the `Accept-Language` fallback. `.ch`
(Switzerland) has four official languages, so it _cannot_ be authoritative for one
of them; it too stays unmapped and follows the browser's regional preference
(`de-CH` -> `de`). Country codes whose language is unambiguous but differs from
the code (`.at` -> German, `.uk` -> English) are opt-in through the `tld` map.
This is why the tld strategy resolves through an explicit, three-tiered policy
rather than the subdomain strategy's pure label-is-locale rule.

## Switching Mechanism: Reload vs. Live

Locale _strategy_ (cookie vs. route) is independent from the _switching
mechanism_ — how a new locale reaches an already-running client. There are two
mechanisms, and the choice matters more for robustness than the strategy does.

### Reload (recommended default)

A switch triggers a full document load in the new locale: writing the cookie and
calling `window.location.assign(...)`, or hard-loading the new locale URL.

- the whole app re-renders from a single, consistent server locale
- there is no client-side reactivity contract to uphold
- module-level caches, memoized `Intl` formatters, and already-fetched data are
  discarded and rebuilt, so mixed-locale states cannot occur
- the only cost is the reload UX: a brief flash, scroll reset, and refetch

The cookie examples use this mechanism.

### Live (opt-in)

A switch swaps the active client i18n in place and re-renders reactively, with no
document load. The route examples use this mechanism — client-side navigation via
the router keeps the app mounted.

Live switching is a whole-app reactivity contract: **every** value derived from
the locale must either live in the reactive graph or be keyed by locale. In
practice the failure mode is rarely the translation components — it is the larger
components with their own state or caches:

- memoized `Intl.NumberFormat` / `Intl.DateTimeFormat` instances not keyed by locale
- data fetched server-side or cached client-side in the previous locale
- third-party components that snapshot strings on mount

Any of these silently goes stale and produces a mixed-locale UI. The library
cannot enforce this discipline for you; it is an ongoing cost you accept per app.

### Recommendation

Prefer reload. It is simpler, has no reactivity contract, and structurally rules
out the mixed-locale class of bugs. Because locale changes are rare and
deliberate, that robustness is almost always worth the small reload UX cost.
Reach for live only when instant, state-preserving switches are a genuine product
requirement and the team is prepared to key every locale-derived value.

### Enabling live switching (Solid)

Reload needs nothing beyond a normal server render. Live switching in Solid has
two opt-in pieces:

- `createClientLocaleEffect(localeAccessor, syncClientI18n)` pushes locale changes
  into the client runtime
- point the macro transform at Solid's reactive runtime so `t` / `plural` output
  follows the switch:

  ```ts
  // app.config.ts
  palamedes({ runtimeModule: "@palamedes/solid/runtime" })
  ```

`<Trans>` / `<Plural>` / `<Select>` / `<SelectOrdinal>` track the active instance
on their own and follow a live switch even with the default `runtimeModule`. Only
the macro `t` / `plural` calls depend on the reactive `runtimeModule` — so wire
both, or use reload.

## Why The Matrix Is Split Per Framework

Each framework family implements routing, request state, and server-side actions
differently. The example matrix is therefore intentionally explicit:

- one cookie app per framework
- one route app per framework

This keeps the integration legible and gives Palamedes a real regression
baseline for:

- tests
- docs
- benchmark-style verification artifacts
- future extraction of shared public helper APIs
