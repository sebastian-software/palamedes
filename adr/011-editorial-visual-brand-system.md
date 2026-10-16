# ADR-011: Editorial Visual Brand System

**Status:** Accepted

**Last updated:** 2026-10-16

One editorial visual language connects product pages, documentation, and inspectable evidence.

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
- larger editorial illustrations, when used, come only from Streamline UX
  Duotone. Keep them distinct from the small Sharp Duo pictograms, preserve
  their geometry, and use the same navy/bronze palette. Use either layer only
  where it helps the reader; avoid repeated decorative icons or illustrations;
- framework marks identify integrations, not customers or adoption. Preserve
  their geometry and record their provenance and usage constraints in
  `site/framework-brand-usage.md`;
- public benchmark values follow the rounding, scope, and evidence policy
  below. Exact values remain available in the checked source artifacts.

ARDO continues to own documentation chrome. Palamedes applies this language
through ARDO's public token and component APIs rather than overriding internal
classes.

### Benchmark Presentation

- Display whole milliseconds below one second and one decimal place for
  multi-second values. Floor public speedup factors so rounding never
  increases a claim. Retain exact medians and ratios in checked reports.
- Derive displayed values from those checked results and fail the site build
  when quoted values drift.
- Describe measured extract-and-catalog-update results as workflow comparisons.
  Exclude narrower extraction-only runs from same-scope headline ranges and
  keep their qualification beside each result. Keep warm-cache measurements
  separate from cross-tool comparisons.
- Prefer a compact results ledger with a dominant time, secondary factor, and
  visible scope per workflow. Keep the environment, corpus, date, and report
  link adjacent. Avoid unit grids or unreadably small linear bars.
- Make claims understandable without graphics and provide equivalent text or
  tables for visual results. Preserve linear reading order, keyboard access,
  responsive reflow, reduced-motion behavior, and readable no-JavaScript output.

### Licensed Asset Handling

The [asset manifest](../site/streamline-asset-manifest.md) owns the exact asset
inventory, export dates, optimized-file hashes, and recorded license allowances.
Store only used, optimized project SVGs under
`site/public/icons/streamline/sharp-duo/` or
`site/public/illustrations/streamline/ux-duotone/`. Replacements stay within
their respective set and update the manifest.

Keep third-party assets outside the repository's MIT OR Apache-2.0 grant.
Preserve the root third-party notice and public Streamline attribution. Do not
redistribute assets as a standalone library or selectable catalog. Licensed
source access stays with the account owner; contributors receive the prepared
project assets. Keep account screenshots, invoices, and license records private.
Count unique assets rather than placements, and do not treat an export limit as
a project usage allowance.

## Context

Palamedes needs one visual language across marketing pages, documentation,
proof artifacts, and shared site UI. A warm editorial masthead and
technical ledger need consistent typography, icon rules, numeric presentation,
and callout treatment. Without a shared contract, individual routes can drift back to
generic documentation chrome, mixed icon families, or several competing
callout systems.

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
geometry and makes licensing/provenance harder to audit. The Sharp Duo inventory and its attribution remain
inspectable in the asset manifest.

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
