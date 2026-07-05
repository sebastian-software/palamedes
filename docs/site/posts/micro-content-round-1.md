# Round 1 Micro-Content

Status: draft

Use these as short LinkedIn/X posts. Each one makes one point and links to one
piece of evidence.

## 1. Matrix

Cross-framework i18n should not be a README claim.

Palamedes keeps twenty examples in the repo: five framework families, each with
cookie, route, subdomain, and tld locale strategies. The browser screenshots are versioned and
come from the same verification flow used in CI.

Evidence: `docs/example-screenshots`

## 2. Runtime Model

The part of Palamedes I care about most is not "Rust-powered."

It is that the runtime model stays the same across framework hosts:
`getI18n()` everywhere, with framework adapters kept thin around it.

Evidence: ADR-005

## 3. Message Identity

Translation keys look tidy until the source text changes and nobody knows what
the key means anymore.

Palamedes uses source-string-first catalogs and `message + context` identity.
That keeps the translator-visible sentence at the center while still handling
ambiguous strings.

Evidence: ADR-003

## 4. Benchmarks

I do not want benchmark claims people have to trust.

Palamedes keeps the proof benchmark command and fixtures in the repo:

```bash
pnpm benchmark:proof
```

Evidence: `docs/proof-and-benchmarks.md`

## 5. Adapters

The more i18n semantics live inside every framework adapter, the harder the
system is to trust.

Palamedes keeps adapters small and moves catalog semantics into one dedicated
engine.

Evidence: ADR-008 and ADR-011

## 6. Ferrocat

Delegating catalog semantics to `ferrocat` was a product decision rather than
a decorative implementation detail.

It keeps PO parsing, catalog updates, ICU diagnostics, and audits in one place
instead of spreading them across plugins.

Evidence: ADR-006

## 7. Quickstart

The first Palamedes quickstart has a narrow goal:

one translated component in about five minutes, with the real packages and the
same catalog model used elsewhere in the repo.

Evidence: `docs/first-working-translation.md`

## 8. Maturity

The honest maturity note matters.

Palamedes has verified framework examples, native catalog tooling, and public
packages. It does not yet have the top-level `palamedes` install path or
`create-palamedes` scaffold.

Evidence: README current-status section
