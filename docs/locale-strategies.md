# Locale Strategies In The Example Matrix

The example matrix proves four authoritative locale strategies — cookie, route,
subdomain, and tld — plus one derived host mapping behavior on top of the route
strategy.

## Language Preference Matching

`preferredLocale()` and the `Accept-Language` fallback in `resolve()` match
preferences case-insensitively and return the original configured locale.
For example, `ZH-hant` selects `zh-Hant` and `PT-br` selects `pt-BR`; catalog
identifiers, cookie values, and canonical URLs keep their configured spelling.

Matching follows the header's quality order, retaining header order for equal
qualities. Each preference first tries an exact tag, then its canonical language
tag without extensions. Remaining candidates must share its language and
script. `Intl.Locale.maximize()` supplies missing script and region fields from
the host's likely-subtag data; explicit scripts are preserved. Within that set,
a unique region match wins, followed by a unique locale without a region, then
a single remaining candidate. Ambiguous matches move on to the next preference.
The order of `locales` never breaks a tie.

With `locales: ["en", "zh-Hans", "zh-Hant"]`:

| Preference                                  | Selected locale                      |
| ------------------------------------------- | ------------------------------------ |
| `zh-Hant`, `ZH-hant`, `zh-Hant-TW`, `zh-TW` | `zh-Hant`                            |
| `zh-Hant-CN`                                | `zh-Hant` (the explicit script wins) |
| `zh-CN`, bare `zh`                          | `zh-Hans`                            |
| `zh-Latn`                                   | `en` (unsupported script)            |

Likewise, bare `pt` selects `pt-BR` when both `pt-BR` and `pt-PT` are supported.
A `pt-AO` preference is ambiguous with those two regional catalogs and falls
back to the next preference or `defaultLocale`. No application-specific alias
map is provided; applications needing another policy can choose a configured
locale before calling their request integration.

A `q=0` range excludes its matching configured tags, subtags, and equivalent
maximized tags from preference matching, so inference cannot reintroduce an
excluded locale. A more specific positive range overrides a broader exclusion:
`de-CH, de;q=0` can select configured `de-CH`, but cannot select generic `de`.
A supported positive preference also overrides `*;q=0`. Malformed or unsupported
tags without a configured exact match are ignored. If no preference
matches, controls return `defaultLocale`, including when every candidate was
excluded; the helper does not produce an HTTP 406 response. A wildcard does not
select an arbitrary configured locale.

Persisted choices and route identifiers have a separate exact contract:
`isLocale()`, `normalizeLocale()`, `readChoice()`, cookie resolution, and route
resolution accept only configured spelling. Use preference matching for browser
language input, and exact validation for catalog and route identity.

## Cookie Strategy

Cookie examples follow this rule set:

- if no locale cookie is present, the server picks the best supported locale
  from `Accept-Language`
- a supported locale cookie is authoritative; an unsupported value falls back
  to `Accept-Language`, then the default locale
- there is no recurring mismatch banner once the cookie strategy has an
  explicit cookie value
- locale switches update the cookie and the next request renders with that
  locale
- locale resolution and read-only handlers do not write or renew cookies
- selecting an already stored locale does not submit another switch; the
  mutation handler also skips `Set-Cookie` when the preference is unchanged
- an initial explicit choice still persists the currently rendered locale when
  the cookie is missing or unsupported

This is the verified path for apps that do not encode locale in the URL.

Use a GET resource loader for read-only React Router queries. A POST action
triggers the framework's normal loader revalidation even when it writes no
cookie. The cookie example's server status panel uses a GET resource route for
this reason. Real mutations keep the framework's normal revalidation behavior.

The shared browser contract checks missing, unsupported, and stored cookies in
the TanStack Start, Solid, Waku, React Router, and Remix cookie examples. It
checks read-only response headers, first-time persistence, unchanged selections,
the server mutation guard, and document navigation after a real switch. Next.js
and React Router RSC have focused production verifiers for their Server Function
transports. Frameworks may refresh route data after a Server Function; the common
contract requires read-only locale resolution without cookie mutation.

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
  via `canonicalUrl`), so it is always a full document load
- `canonicalUrl` and `suggest` return protocol-relative URLs (`//de.example.com/…`)
  unless the config sets `protocol` (for example `protocol: "https"`). The
  default keeps the same configuration correct on http locally and https in
  production; set it when the URLs must be absolute, as in canonical link tags,
  `hreflang` alternates, or sitemaps. See
  [`defineLocaleControls`](api/core.md#locale-controls).

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

- `<app>.examples.palamedes-i18n.de` -> `de`
- `<app>.examples.palamedes-i18n.fr` -> `fr`
- `<app>.examples.palamedes-i18n.com` -> `en` (explicit override)

TLD examples follow this rule set:

- the tld is resolved by `resolve({ strategy: "tld", requestHost })`, three-tiered:
  1. a tld label that already _is_ a supported locale is authoritative
     automatically (`.de` -> `de`, `.es` -> `es`, `.fr` -> `fr`), because the
     country code equals the language code
  2. a tld whose label is not a language code is authoritative when listed in the
     `tld` map. These demos map the generic `.com` to `en`
     (`hosts: { mode: "tld", tld: { com: "en" } }`); real deployments might add
     entries such as `{ at: "de", uk: "en" }`
  3. anything else is deliberately not authoritative and falls back to the best
     `Accept-Language` match (region tags expand, so `de-CH` yields `de`), then
     the default locale
- there is no `/:locale/...` path prefix; the locale lives in the domain
- switching locale swaps the top-level domain (the control swaps the rightmost
  label via `canonicalUrl`), so it is always a full document load. The default
  locale `en` switches to `defaultTld`
  (`hosts: { mode: "tld", defaultTld: "com" }`, so `en` -> `.com`), which the
  `.com` -> `en` override above also serves authoritatively
- as with the subdomain strategy, the emitted URLs are protocol-relative unless
  the config sets `protocol` (for example `protocol: "https"`). See
  [`defineLocaleControls`](api/core.md#locale-controls).

### Why real TLDs need an explicit policy

Unlike the subdomain label — which the operator fully controls, so the label can
simply _be_ the locale — real top-level domains carry meaning the app does not
own. `.de`, `.es`, and `.fr` happen to match a language code and resolve
automatically. `.com` is generic and matches no language, so these demos map it
explicitly to `en` (`{ com: "en" }`), the natural default for a generic TLD.
`.ch` (Switzerland) has four official languages, so it _cannot_ be authoritative
for one of them; left unmapped, it follows the browser's regional preference
(`de-CH` -> `de`) and then the default locale. Country codes whose language is
unambiguous but differs from the code (`.at` -> German, `.uk` -> English) are
opt-in through the same `tld` map. This is why the tld strategy resolves through
an explicit, three-tiered policy rather than the subdomain strategy's pure
label-is-locale rule.

## Client-Side Suggestions For Prerendered Pages

Static sites can keep locale selection in the build and URL while offering a
client-side language suggestion. `suggest()` already provides the decision and
canonical destination; the app supplies browser context and renders any UI it
wants. Palamedes does not read browser globals or change the prerendered page.

```ts
import {
  consumeChoiceHandoff,
  createChoiceHandoffUrl,
  defineLocaleControls,
} from "@palamedes/core/locale";

const locales = defineLocaleControls({
  locales: ["en", "de"],
  defaultLocale: "en",
  hosts: { mode: "tld", defaultTld: "com", tld: { com: "en" } },
});

const currentLocale = locales.preferredLocale(document.documentElement.lang);
const suggestion = locales.suggest({
  currentLocale,
  acceptLanguageHeader: navigator.languages.join(","),
  cookieHeader: document.cookie,
  pathname: location.pathname,
  requestHost: location.host,
  search: location.search,
});

if (suggestion) {
  const href = createChoiceHandoffUrl({
    url: suggestion.recommendedUrl,
    locale: suggestion.recommendedLocale,
    currentOrigin: location.origin,
  });
  const onSelectSuggestion = () => {
    document.cookie = locales.serializeChoice(suggestion.recommendedLocale);
  };
  // Render your own localized link with href and onSelectSuggestion.
}
```

The URL helper carries an explicit choice to a different origin so the
destination can persist its own choice cookie and avoid suggesting a switch
back immediately. On the destination, consume the parameter before making
another suggestion:

```ts
const handoff = consumeChoiceHandoff({
  search: location.search,
  currentLocale,
  locales: locales.locales,
});

if (handoff.choice) {
  document.cookie = locales.serializeChoice(handoff.choice);
}
if (handoff.search !== location.search) {
  history.replaceState(history.state, "", `${location.pathname}${handoff.search}${location.hash}`);
}
```

The helpers are pure. The app owns the rendered copy and markup, the timing of
cookie writes, and URL replacement. Browser language detection alone does not
persist a preference or navigate.

## Switching Locale

Locale _strategy_ (cookie, route, subdomain, or TLD) is independent from the
browser lifecycle. Palamedes treats the selected locale as immutable document
bootstrap state. A switch updates the strategy input and loads a new document:
write the cookie and call `window.location.assign(...)`, submit a normal form,
or follow a plain locale URL.

- the whole app re-renders from a single, consistent server locale
- there is no client-side reactivity contract to uphold
- module-level caches, memoized `Intl` formatters, and already-fetched data are
  discarded and rebuilt, so mixed-locale states cannot occur
- the tradeoff is the navigation UX: scroll and transient client state reset,
  and data may be fetched again

All official examples use this mechanism.

### Why Palamedes Does Not Provide Live Switching

Changing only the active i18n instance would require **every** locale-derived
value in the application to be reactive or keyed by locale. Translation
components are only one part of that state. Common stale values include:

- memoized `Intl.NumberFormat` / `Intl.DateTimeFormat` instances not keyed by locale
- data fetched server-side or cached client-side in the previous locale
- third-party components that snapshot strings on mount

Any of these can silently retain the previous language. Palamedes therefore
does not expose framework subscriptions or claim that an i18n-instance swap is
a safe locale change.

### Unsupported Root-Key Escape Hatch

If an application knowingly accepts the responsibility, it can initialize a
new client i18n instance and remount its entire localized UI:

```tsx
<LocalizedApplication key={locale}>{children}</LocalizedApplication>
```

The new instance must be active **before** the keyed subtree mounts. The key
only resets framework-owned state below that point; module caches, external
stores, query clients, browser state, and third-party code remain the
application's responsibility. Palamedes intentionally provides no convenience
API or correctness guarantee for this pattern.

## Why The Matrix Is Split Per Framework

Each framework family implements routing, request state, and server-side actions
differently. The example matrix is therefore intentionally explicit:

- one cookie app per framework
- one route app per framework
- one subdomain app per framework
- one tld app per framework

This keeps the integration legible and gives Palamedes a real regression
baseline for:

- tests
- docs
- benchmark-style verification artifacts
- future evolution of the shared public locale-control APIs
