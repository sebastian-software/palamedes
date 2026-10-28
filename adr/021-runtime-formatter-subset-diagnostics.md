# ADR-021: Runtime Formatter Subset Diagnostics

**Status:** Accepted

**Last updated:** 2026-10-28

Compilation validates formatter support before messages reach the application runtime.

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
fatal compilation errors. The compiled-only runtime contract in ADR-004 and
ADR-005 requires messages to have their supported meaning established before
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

Standalone application formatting helpers are outside this decision; it
constrains formatting inside translated message patterns.

## Context

Palamedes runtime formatting intentionally covers a small ICU formatter subset
that maps directly to platform `Intl` APIs. The current runtime can render
plain `number`, `date`, and `time` arguments plus a few common styles, but it
does not implement every formatter kind or ICU skeleton that translators may
write in PO files.

Valid ICU syntax does not establish that the runtime supports a formatter or
style. Compilation must distinguish unsupported semantics from malformed ICU
and reject both before producing executable messages.

## Alternatives Considered

### 1. Implement formatter validation entirely inside Palamedes

Rejected because identifying ICU formatter references is generic MessageFormat
analysis. Keeping that analysis in Ferrocat preserves the catalog boundary from
ADR-009 and avoids a second local ICU walker.

### 2. Warn about unsupported styles and substitute default formatting

Rejected because it silently changes the authored formatting intent. The compiled-only contract requires unsupported ICU to fail compilation.

### 3. Expand the runtime to full ICU skeleton support first

Rejected as larger scope. The immediate need is to make the existing runtime
contract explicit and reviewable in catalog artifacts.

## Consequences

- Catalog artifact diagnostics report runtime-incompatible formatter kinds
  with `icu.unsupported_formatter_kind`.
- Catalog artifact diagnostics report unsupported styles on supported
  runtime formatter kinds with `icu.unsupported_formatter_style`.
- Diagnostics use the compiled artifact source key and the locale that provided
  the final runtime message, including source-locale fallbacks for missing
  translations.
- Future runtime formatter expansion should update this ADR, the Core runtime
  docs, and the Palamedes runtime policy together.

## Validation

Module compilation rejects unsupported formatter kinds and styles. Artifact
inspection returns structured diagnostics without claiming to produce an
executable module. Host adapters reject the removed v1 `failOnCompileError`
option with a migration error, so no option can downgrade an error. See the [Core API reference](../docs/api/core.md).
