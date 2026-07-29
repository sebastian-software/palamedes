# ADR-021: Shared Cross-Repository Site UI

**Status:** Accepted
**Date:** 2026-07-29
**Last updated:** 2026-07-29

## Context

`palamedes.dev` is part of this open-source repository. The future
`plus.palamedes.dev` site belongs to the separate commercial repository. They
should look and navigate like related products without copying layout
components, coupling deployments, or requiring the commercial repository to
reach into private paths in this workspace.

The OSS site currently uses React Router and ARDO. A shared package tied to
either library would make it harder for the Plus site to reuse the design
contract and would turn an integration detail into a cross-repository API.

## Decision

`packages/site-ui` is the open-source source package for shared site chrome.
It owns:

- Hellenic Spec Grid tokens and self-contained component CSS
- `SiteHeader`, `SiteFooter`, `SiteShell`, `Wordmark`, `Page`, `Section`,
  `Reveal`, and button/link primitives
- typed site configuration for navigation, footer columns, primary action,
  and an explicitly enabled or disabled counterpart link
- `SiteUiProvider`, which lets each consumer inject its own router-aware link
  component

The package depends only on React. It does not depend on React Router, ARDO, a
site's content tree, or files outside its package directory. Its component CSS
works when imported directly by a plain Vite application; Tailwind theme and
utility declarations are an additive integration for the OSS site.

The OSS site consumes the package with `workspace:*` and keeps its ARDO adapter
in `site/`. A separate repository consumes a complete commit pin of the package
subdirectory. Local links may be used while developing both repositories, but
must not be committed as the reproducible dependency.

Cross-product navigation is configuration, never hostname detection. The
Palamedes+ destination is present but disabled in the OSS configuration until
that site is live.

## Alternatives Considered

### Copy the components into both sites

Rejected because fixes to layout, accessibility, tokens, and responsive
behavior would drift immediately.

### Share the whole OSS site application

Rejected because routes, content, ARDO integration, deployment, and product
claims have different owners and release schedules.

### Couple the package to React Router or ARDO

Rejected because those are consumer integration choices. The injected link
contract preserves client-side routing without making it part of shared UI.

## Consequences

- Shared component and token changes are reviewed publicly in Palamedes.
- Every consuming site supplies its own navigation data and router adapter.
- A counterpart link cannot appear merely because a hostname or environment
  variable happens to exist; it must be deliberately enabled.
- Changes to exported props, CSS variables, or `.pmds-*` classes are
  cross-repository interface changes and require tests in both consumers.

## Validation And Review Triggers

Review this decision when:

- the sites no longer share a React rendering layer
- the source package needs a published package release instead of a commit pin
- ARDO can consume the shared header directly without weakening its docs
  behavior
- a new product site needs the design system but not the current chrome
