# ADR-015: Runtime Formatter Subset Diagnostics

**Status:** Accepted
**Date:** 2026-06-12
**Revised:** 2026-09-11

## Context

Palamedes runtime formatting intentionally covers a small ICU formatter subset
that maps directly to platform `Intl` APIs. The current runtime can render
plain `number`, `date`, and `time` arguments plus a few common styles, but it
does not implement every formatter kind or ICU skeleton that translators may
write in PO files.

Before this decision, catalog artifact compilation validated ICU syntax and
source/translation compatibility, but it did not make the runtime formatter
subset explicit. Unsupported formatter kinds could reach runtime artifacts
without a targeted diagnostic, and unsupported styles were hard to distinguish
from fully invalid ICU.

## Decision

Palamedes validates final compiled catalog artifacts against the runtime
formatter subset after Ferrocat compiles the artifact.

The supported runtime subset is:

- `number` with no style
- `number` with `percent` or `integer`
- `number` with `::percent`, `::integer`, or `::currency/ISO`
- `date` and `time` with no style
- `date` and `time` with `short`, `medium`, `long`, or `full`

Currency formatting intentionally requires the `::currency/ISO` skeleton form;
bare `currency/ISO` is treated as outside the runtime formatter subset.

Palamedes treats unsupported formatter kinds such as `list`, `duration`, `ago`,
and `name`, and unsupported styles on otherwise supported formatter kinds, as
fatal compilation errors. The compiled-only runtime contract in ADR-022 and
ADR-023 requires messages to have their supported meaning established before
execution. Substituting default `Intl` options for an unsupported style does not
fulfill that contract.

Invalid ICU and unsupported constructs fail compilation in development and
production. Host adapters must surface diagnostics identifying the affected
catalog, locale, and source message; they cannot turn these errors into warnings
through an opt-out such as `failOnCompileError: false`. Diagnostic collection
for authoring and audit tools can still return structured findings without
producing an executable catalog.

Generic ICU formatter support analysis lives in Ferrocat. Palamedes supplies
only the runtime-specific policy and maps Ferrocat diagnostics back to compiled
artifact source keys and resolved locales.

This PR does not add standalone `i18n.formatNumber()` or `i18n.formatDate()`
helpers. Those can be evaluated separately if application authors need direct
formatting APIs outside translated message patterns.

## Alternatives Considered

### 1. Implement formatter validation entirely inside Palamedes

Rejected because identifying ICU formatter references is generic MessageFormat
analysis. Keeping that analysis in Ferrocat preserves the catalog boundary from
ADR-006 and avoids a second local ICU walker.

### 2. Warn about unsupported styles and substitute default formatting

Rejected because it silently changes the authored formatting intent. Earlier
revisions accepted this behavior; the September 2026 compiled-only contract
requires unsupported ICU to fail compilation instead.

### 3. Expand the runtime to full ICU skeleton support first

Rejected as larger scope. The immediate need is to make the existing runtime
contract explicit and reviewable in catalog artifacts.

## Consequences

- Catalog artifact diagnostics now report runtime-incompatible formatter kinds
  with `icu.unsupported_formatter_kind`.
- Catalog artifact diagnostics now report unsupported styles on supported
  runtime formatter kinds with `icu.unsupported_formatter_style`.
- Diagnostics use the compiled artifact source key and the locale that provided
  the final runtime message, including source-locale fallbacks for missing
  translations.
- Future runtime formatter expansion should update this ADR, the Core runtime
  docs, and the Palamedes runtime policy together.

## Implementation status

The supported formatter subset and diagnostics are enforced during module
compilation. Unsupported styles are fatal, as are unsupported formatter kinds,
and generated modules never emit a lazy-parser fallback. Artifact inspection
APIs still return structured diagnostics so audits can report the complete or
selected validation scope without claiming that an executable module was
produced. The deprecated `failOnCompileError` option emits a v2 migration
diagnostic and cannot downgrade an error.
