# ADR-011: Editorial Visual Brand System

**Status:** Accepted

**Last updated:** 2026-11-03

Palamedes keeps its identity in local content and brand choices while delegating
site structure and component styling to Ardo.

## Decision

Use Ardo's public components and theme options for the OSS site's header,
footer, search, document layout, navigation, outline, code, and focus styles.
Keep a small local marketing layer for product specimens and editorial sections.

- Set the paper, parchment, mist, navy, and bronze palette through Ardo's typed
  theme options. Marketing utilities reference the same semantic tokens; do not
  maintain a parallel palette or restyle Ardo's internal selectors.
- Keep the logo, Cinzel Hellenic marketing headings, product specimens, and
  licensed artwork local. Exact values live in the theme and stylesheet.
- Keep inscription-style marketing headings, fine rules, and square bronze
  marketing actions. Ardo retains its own document typography, component corners,
  and elevation. Scroll reveals, ornamental meanders, and animated connectors
  are not required brand features.
- Use Ardo's full-width shell and public `ArdoContentContainer` for bounded
  marketing content. Guides retain a reading measure; API references use the
  wider page measure. Ardo owns gutters and responsive layout.
- Use one simple Ferramenta link instead of a family tool menu or sibling list.
- Explain unfamiliar concepts beside their artifacts, including the existing
  "In plain words" asides. Editorial rails remain local one-pixel rules.
- Share structural and accessibility improvements through Ardo. Never introduce
  Palamedes-specific visual defaults into the common theme, and do not require
  unrelated Ardo sites to adopt this site's appearance.
- Framework marks identify integrations, not customers or adoption. Preserve
  their geometry and provenance in `site/framework-brand-usage.md`.
- Existing Streamline artwork remains subject to the asset handling rules below.
  New artwork must explain content rather than fill empty space.

Restore the recognizable inscription-and-ledger identity through this small
local layer. Future visual additions must justify their maintenance cost;
restoring the brand does not require a second site shell.

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

The OSS site previously combined Ardo with shared site chrome and a second
complete palette. Local CSS then restyled those shared primitives again.
Ardo 6 already supplies the document and shell behavior we need, so this made
visual changes harder to reason about without adding product functionality.
The simpler boundary keeps branded content local and general framework
behavior upstream.

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

- Ardo carries shell and document changes; local marketing code carries product-specific presentation.
- New callouts use `EditorialRail`; the site build guard rejects a return of
  `border-l-4` callouts under `site/app`.
- Designers and implementers must preserve adjacent scope and provenance for
  public numbers rather than treating them as decorative statistics.
- Streamline additions require a manifest entry, license verification, and the
  repository attribution described by the asset manifest.
- Framework marks retain their own trademark constraints and are not evidence
  of customer adoption.

## Validation And Review Triggers

`scripts/verify-site-editorial-rails.mjs` enforces the one-pixel rail contract.
The site benchmark guard verifies checked numeric presentation. Revisit this
decision when a local visual addition needs more theme overrides, Ardo exposes
a useful structural capability, the icon license or selected family changes, or accessibility
testing shows that a token or type treatment cannot meet the documented
contrast and reflow requirements.
