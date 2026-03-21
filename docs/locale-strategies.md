# Locale Strategies In The Example Matrix

The example matrix proves two primary locale strategies and one derived host
mapping behavior.

## Cookie Strategy

Cookie examples follow this rule set:

- if no locale cookie is present, the server picks the best supported locale
  from `Accept-Language`
- once the locale cookie exists, the cookie is authoritative
- there is no recurring mismatch banner once the cookie strategy has an
  explicit cookie value
- locale switches update the cookie and the next request renders with that
  locale

This is the proof path for apps that do not encode locale in the URL.

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

This is the proof path for SEO-oriented or shareable locale URLs.

## Domain And Host Mapping

Domain-based locale selection is modeled as an extension of the route strategy.

The examples treat host mapping as:

- a host-to-locale map such as `de.lvh.me` -> `de`
- an additional validation signal on top of `/:locale/...`
- a source of mismatch hints, not an automatic redirect

When host mapping disagrees with the rendered locale, the example shows the same
info bar used for `Accept-Language` mismatches, but the CTA points to the
canonical host plus path for the recommended locale.

## Why The Matrix Is Split Per Framework

Each framework family implements routing, request state, and server-side actions
differently. The example matrix is therefore intentionally explicit:

- one cookie app per framework
- one route app per framework

This keeps the integration legible and gives Palamedes a real regression-proof
surface for:

- tests
- docs
- benchmark-style proof artifacts
- future extraction of shared public helper APIs
