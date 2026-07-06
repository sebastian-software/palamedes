---
date: "2026-07-05"
---

# What we delegated to Ferrocat and why

Palamedes started with a simple product goal: make JavaScript i18n feel smaller
without making the underlying semantics vague.

That meant resisting the usual temptation to let every package own a little
piece of catalog behavior. Parsing, updating, merging, metadata, obsolete
entries, ICU diagnostics, and storage formats all look small in isolation. They
do not stay small once apps, CLIs, plugins, tests, and release workflows all
need to agree.

So Palamedes delegates catalog semantics to Ferrocat.

## The boundary

Palamedes owns the JavaScript-facing product model:

- source-string-first authoring
- `message + context` as public identity
- framework adapters and runtime wiring
- the CLI workflow users run every day

Ferrocat owns the catalog engine work:

- PO and FCL parsing
- catalog updates
- semantic merge behavior
- ICU authoring diagnostics
- metadata and origin handling

That split keeps the public Palamedes surface calmer. The docs can say "source
strings are the identity" without every package quietly implementing its own
version of what that means.

## Why delegation helped

Delegation made the system easier to review. When `pmds extract`,
`pmds audit`, native catalog APIs, and framework loaders agree, it is not
because four call sites copied the same logic. It is because they meet at the
same catalog boundary.

It also made storage choices less dramatic. PO remains the default because it
is translator-readable and familiar. FCL exists for teams that want canonical,
merge-friendly generated storage. Both are product choices exposed by
Palamedes, but the careful parsing and update semantics live in one engine.

## What to inspect

The useful evidence is in the repo:

- [`docs/catalog-formats.md`](../../catalog-formats.md)
- [`docs/stability.md`](../../stability.md)
- [`docs/cli.md`](../../cli.md)
- [`adr/006-ferrocat-as-catalog-and-icu-foundation.md`](../../../adr/006-ferrocat-as-catalog-and-icu-foundation.md)

The lesson is not "use Rust for everything." The lesson is narrower: give the
hard semantic layer one owner, then let the JavaScript packages stay small.
