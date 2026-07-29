# ADR-001: Project Scope and Open Positioning

**Status:** Accepted
**Date:** 2026-03-17
**Last updated:** 2026-07-29

## Context

Palamedes needs a durable definition of what it owns, how it differs from
adjacent tools, and how the project communicates those choices.

Many established i18n libraries grew under different constraints:

- broad backward compatibility
- support for many historical API styles
- multiple overlapping runtime models
- a mix of build-time and runtime concerns spread across many packages

Palamedes deliberately avoids that overlap, but “opinionated” no longer means
“small” or “narrow”. The project now covers transformation, extraction, catalog
updates, audits, semantic merging, compilation, runtime integration, and
first-party adapters across several frontend and server hosts. Its verified
framework matrix and CI flows are part of the product strength, not incidental
examples.

The repository is also public. Product and marketing reasoning committed here
is visible to users, contributors, competitors, and future maintainers.
Describing that material as an “internal story” creates a false distinction and
makes the open-source project sound less candid than it is.

Finally, two general product narratives would drift. `PRODUCT.md` and a
separate storyline document would both try to answer what Palamedes is and how
to present it, without a meaningful ownership boundary between them.

Palamedes and the planned Palamedes+ product also need a repository and content
boundary that users can understand. Technical comparison of open-source client
libraries helps people evaluate this project. Pricing, company, market, hosted
platform, AI-service, and other commercial research serves the managed product
and would blur the promise of this repository if it remained here.

## Decision

Palamedes is open-source i18n tooling for TypeScript applications with one
coherent model from source to runtime.

Its local workflow includes:

- macro-style authoring close to the code
- source transformation and message extraction
- repository-owned source-string-first PO and FCL catalogs
- catalog updates, audits, ICU diagnostics, and completeness gates
- semantic catalog merging and runtime artifact compilation
- one public runtime access model through `getI18n()`
- first-party integrations for supported frontend and server hosts

The product is opinionated about how those concerns fit together:

- `message + context` is the public identity model
- `getI18n()` is the public runtime access model
- `ferrocat` owns catalog and ICU semantics
- the native core owns shared semantic work
- host adapters stay thin and do not invent competing catalog semantics

Host frameworks continue to own routing, URL design, locale detection policy,
rendering, and hosting. Palamedes integrates with those decisions instead of
becoming a route-centric application framework.

Palamedes is explicitly not:

- a compatibility-first reimplementation of Lingui
- a route-centric framework for locale negotiation and page-level routing
- a general-purpose replacement for every i18n concern an application may have
- a project that keeps historical migration stages as part of its canonical architecture

Palamedes+ is the planned optional managed layer for translation automation and
collaboration. Palamedes covers the full local open-source workflow without an
account or managed service.

The repository boundary follows that product boundary:

- this repository contains Palamedes OSS, `palamedes.dev`, and technical
  comparison of genuinely open-source client SDKs and frameworks
- the private `palamedes-plus` repository contains the commercial product,
  commercial market research, pricing research, and the future
  `plus.palamedes.dev` site
- hybrid projects are compared here only to the extent that their client SDK
  is open source; hosted services and commercial platform features are out of
  scope
- source-available SDKs with non-open-source restrictions are commercial
  research and do not get an OSS comparison page
- cross-product links remain explicit configuration and are not published
  from `palamedes.dev` until the Plus destination is live

The two sites share open-source layout primitives and design tokens from
`packages/site-ui`; their content, deployment, product claims, and release
timing remain independent.

Product communication follows the same architecture:

- Lead with the coherent TypeScript workflow and the capabilities it gives
  teams, not with “small”, “lightweight”, or “narrow”.
- Present framework breadth as verified proof that the model survives different
  application shapes; do not imply that one adopter must use several
  frameworks.
- Tie performance claims to checked benchmark workflows and exact reports.
- State boundaries and cases where another tool is stronger without promoting
  every question from one conversation into a product requirement.
- Keep product and marketing reasoning open in the repository. “Internal”
  remains valid only for genuine implementation details or unsupported API
  surfaces.

Artifact ownership is explicit:

- [`PRODUCT.md`](../PRODUCT.md) is the concise, current product and marketing
  context: audience, purpose, messaging spine, brand personality, and design
  principles.
- This ADR records the durable decision, its rationale, its tradeoffs, and the
  conditions that should reopen it.

## Alternatives Considered

### 1. Broad compatibility-first scope

This would preserve more old API shapes and migration paths.

Rejected because it would make historical compatibility more important than a
coherent end state.

### 2. Framework-first product scope

This would make Vite or Next.js integration the defining center of the architecture.

Rejected because framework APIs are host-specific and should not define the
core i18n model.

### 3. “Small and narrow” positioning

This would continue presenting Palamedes primarily as a minimal alternative to
larger libraries.

Rejected because it confuses a clear decision model with a small capability
surface and understates the native workflow, adapter coverage, CI verification,
and catalog functionality that already exist.

### 4. Separate or private marketing storyline

This would keep a second general narrative beside `PRODUCT.md`, or treat
marketing rationale as material meant only for maintainers.

Rejected because the documents would drift and because no committed repository
document is private. Open reasoning is a trust signal and lets contributors
review whether public claims match the implementation.

## Consequences

- New features are evaluated against the opinionated product scope, not against
  compatibility pressure alone.
- Framework adapters and tooling packages stay aligned with the core model
  instead of growing separate semantics.
- Public copy targets TypeScript teams and describes the full local workflow.
- “Small” and “narrow” remain available for exact technical comparisons, such
  as benchmark corpora or runtime bundle tradeoffs, but not as the general
  product identity.
- Product claims need nearby evidence: verified examples, checked reports,
  executable proofs, or decision records.
- Product and marketing rationale remains inspectable in the repository.
- `PRODUCT.md` is the single general-purpose working context. Removing the
  parallel storyline reduces discovery cost and prevents message drift.
- Palamedes+ can extend the workflow without making the local open-source
  toolchain less useful on its own.
- Public comparison pages stay focused on inspectable open-source client code.
- Commercial claims and volatile market facts are maintained with the
  commercial product rather than mirrored into this repository.
- Shared visual chrome does not imply a shared deployment or make either site
  depend on the other at runtime.

## Validation And Review Triggers

Review this decision when:

- Palamedes supports a materially different authoring or runtime model
- framework adapters begin owning shared catalog semantics
- the primary audience moves beyond TypeScript teams
- Palamedes+ becomes available and changes the boundary between local and
  managed workflows
- a compared client SDK changes license or a comparison expands into hosted,
  pricing, company, or market claims
- either site needs a cross-product link before the destination is live
- public copy again describes the product primarily as small or narrow
- a new general positioning document duplicates `PRODUCT.md`

Current alignment is visible in:

- [`PRODUCT.md`](../PRODUCT.md)
- the [homepage](../site/app/routes/home.tsx)
- the [framework matrix](../site/app/components/frameworks/FrameworkMatrix.tsx)
- the [proof page](../site/app/routes/proof.tsx)
- checked benchmark reports under `benchmarks/`
