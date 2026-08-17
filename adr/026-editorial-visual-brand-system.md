# ADR-026: Editorial Visual Brand System

**Status:** Accepted
**Date:** 2026-08-16

## Context

Palamedes needs one visual language across marketing pages, documentation,
proof artifacts, and shared site UI. The homepage revamp established a warm
editorial masthead over a technical ledger, but its tokens, typography, icon
rules, numeric presentation, and callout treatment were not yet recorded as a
durable decision. Without that contract, individual routes can drift back to
generic documentation chrome, mixed icon families, or several competing
callout systems.

## Decision

Use the **Monument core × Editorial masthead** system for all Palamedes web
surfaces:

- warm paper `#faf9f4` is the ground, navy `#0e2a4d` is the primary ink, and
  bronze `#8e6628` is the single semantic accent;
- Cinzel Hellenic is the display face, paired with restrained body type, mono
  uppercase micro-labels, and tabular numbers;
- micro-labels use one 10 px treatment (11 px is reserved for the larger
  eyebrow role), and `gray-spec` is no lighter than `#6f695b` on paper so
  small text retains WCAG AA contrast;
- mastheads and running heads use rules, alignment, and whitespace rather than
  cards; border radius, box shadows, and gradients are outside the system;
- structural rules are one-pixel hairlines. Editorial qualifications, asides,
  and boundaries use the shared `EditorialRail` primitive. Its structural tone
  uses ink/hairline tokens; its emphasis tone may use bronze. Thick colored
  side tabs are not part of the system;
- bronze communicates interaction or semantic emphasis. Ordinary grouping
  must not spend the accent merely for decoration;
- non-brand marketing pictograms use only licensed Streamline Sharp Duo
  exports recorded in `site/streamline-asset-manifest.md`. Framework and vendor
  marks are the intentional brand exception;
- public benchmark values follow the checked rounding and scope policy in
  `site/homepage-revamp-concept.md`: whole milliseconds below one second, one
  decimal for multi-second values, and floored speedup factors. Exact values
  remain available in the checked source artifacts.

ARDO continues to own documentation chrome. Palamedes applies this language
through ARDO's public token and component APIs rather than overriding internal
classes.

## Alternatives Considered

### Per-route styling

Rejected. Local choices recreate the drift this decision is intended to stop
and make proof, marketing, and generated documentation look like separate
products.

### Thick accent callouts

Rejected. Four-pixel side tabs compete with the ledger grid and make bronze a
generic grouping device instead of a meaningful accent.

### Mixed open icon libraries

Rejected. Mixing Lucide or other sets with Sharp Duo loses the deliberate
geometry and makes licensing/provenance harder to audit. Lucide was used only
as a documented transition state and was removed when the licensed Sharp Duo
selection was committed.

## Consequences

- Shared components and tokens carry visual changes across all site surfaces.
- New callouts use `EditorialRail`; the site build guard rejects a return of
  `border-l-4` callouts under `site/app`.
- Designers and implementers must preserve adjacent scope and provenance for
  public numbers rather than treating them as decorative statistics.
- Streamline additions require a manifest entry, license verification, and the
  repository attribution described by the asset manifest.
- Framework marks retain their own trademark constraints and are not evidence
  of customer adoption.

## Validation And Review Triggers

The shared site UI tests distinguish structural and emphasis rails, and
`scripts/verify-site-editorial-rails.mjs` enforces the one-pixel rail contract.
The site benchmark guard verifies checked numeric presentation. Revisit this
decision when the brand palette or display type changes, ARDO exposes a new
theme contract, the icon license or selected family changes, or accessibility
testing shows that a token or type treatment cannot meet the documented
contrast and reflow requirements.
