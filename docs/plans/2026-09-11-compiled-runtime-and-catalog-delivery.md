# Palamedes v2: unified compiled runtime and catalog delivery

**Status:** Accepted plan; GitHub issues published; implementation pending
**Date:** 2026-09-11

## Problem

Compiled message execution and automatic catalog splitting are implemented,
but first-party integrations still expose different runtime and loading models.
Package roots retain ICU parsing, several examples load all languages eagerly,
and Remix transports uncompiled ICU catalogs to the client. Vite import-map
delivery still requires application-owned manifest and HTML integration.

## Confirmed decisions

- The complete public application runtime is compiled-only on both server and
  client. Runtime parsing of uncompiled ICU catalogs is not a supported product
  mode. ICU remains part of authoring, translation, validation, and compilation.
- Update living ADRs directly: [ADR-022](../../adr/022-generated-catalogs-use-executable-message-functions.md)
  and [ADR-023](../../adr/023-generated-production-runtime-is-parser-free.md)
  record this accepted target and distinguish it from unfinished implementation.
- Compiled constant strings remain valid. Removing runtime parsing is separate
  from choosing full catalogs versus automatically selected fragments.
- Invalid or unsupported ICU must fail compilation in both development and
  production. This applies to source messages and translations, including
  unsupported formatter styles. Diagnostics identify catalog, locale, and
  source message. No silent default-format substitution, lazy-parser output,
  or adapter opt-out can make these failures successful compilations.
  [ADR-015](../../adr/015-runtime-formatter-subset-diagnostics.md) records the
  aligned formatter policy. Missing translations are a separate case.
- Missing translations use the configured fallback locale chain and ultimately
  the source message by default. That result is compiled exactly like a
  translation, including variables, plurals, and rich text. Missing translations
  remain diagnosable, and `failOnMissing` can enforce target-locale completeness.
  Invalid or unsupported fallback messages remain fatal compilation errors.
  This decision covers catalog compilation, not recovery from a failed runtime
  fragment request or source patterns embedded at call sites.
- Required compiled catalogs and fragments are execution dependencies. A failed
  load or unexpected missing compiled entry must reach host error handling.
  The affected UI must not render incomplete localized content: use a framework
  error boundary or host equivalent. Server execution reports failure rather
  than returning partially localized success. Internal IDs, raw ICU patterns,
  and substitute call-site source text must not be exposed as message output.
  Developer diagnostics may identify internal keys; end-user error UI must not
  dump those diagnostics. Build-time compiled translation fallback is unaffected.
- Standard framework catalog loading is transparent to application authors.
  Macros and supported extraction surfaces drive message dependencies; adapters
  load and initialize them before use. No application-owned catalog imports,
  locale loader maps, catalog boundaries, or import-map HTML plumbing are
  required. Locale selection and ordinary framework error UI remain with the
  host/application. [ADR-008](../../adr/008-framework-adapter-architecture.md)
  records adapter ownership. Runtime import paths are implementation details
  of this integration, not an extra product choice.
- Converge package roots and existing `compiled` subpaths on one parser-free
  implementation, retaining compatible subpath aliases. Treat exact export
  mapping as migration engineering rather than an application loading option.
- Ship this contract as Palamedes v2, a coordinated major release with a
  migration guide and no permanently maintained legacy runtime mode. Work can
  land in dependent implementation issues, but the release must present a
  coherent contract across its supported integrations. Compatible import aliases
  may remain without retaining parser behavior. No release date is committed.
- Complete compiled catalogs of the active locale are allowed on the server;
  universal server-side module splitting is not required for v2. Load locales
  on demand and reuse immutable catalog content per process with lightweight,
  isolated request state. Do not eagerly evaluate all configured languages or
  rebuild complete lookup structures for every request. Measure actual memory,
  including module-cache retention and copies across workers. Redis was a
  comparison, not an implementation proposal; no Redis integration is planned.

## Server memory investigation

The current Next cookie example dynamically imports the active locale, while
the React Router cookie server example statically imports all locale catalogs.
Core `load()` currently allocates a lookup entry wrapper per message per
instance; message function values are reused, not recompiled per request.
V2 will use shared immutable compiled catalogs with lightweight request-local
views while preserving additive load/override semantics and development
invalidation. The concrete data structure is an implementation choice.

Lazy ESM imports avoid eager evaluation of unused locales, but module caching
can retain every locale eventually used by a long-lived process. Do not claim
a bounded LRU cache merely because an application map is bounded. Verify actual
retained memory and multi-worker duplication with a representative fixture.

Redis was raised only as a comparison to understand where memory lives. It is
not an implementation proposal or a planned investigation. No external cache
service is required for v2.

## Implementation sequence

The [eleven implementation issues](2026-09-11-palamedes-v2-issues.md) contain
concrete outcomes, acceptance criteria, and dependencies:

1. A: strict compilation and valid compiled translation fallback.
2. B: unified public compiled runtime with propagated failures.
3. C: lazy shared server catalogs and measured request-state allocation.
4. D, E, and J: independent complete Next, Vite/React Router, and Remix paths.
5. F–I: TanStack, Solid, Waku, and React Router RSC integrations using E's
   shared delivery seams.
6. K: packaged migration and release verification across the completed hosts.

Existing #1144 supplies shared config helpers before D, E, and J. Existing
#1139 must complete before K's final release verification; prefer it before
mixed sync/async compiler stress tests, but A can be developed in parallel.
Both fixes can ship compatibly in 1.x before the v2 feature work.

All slices include their relevant tests and documentation. K is the final
cross-host release gate, not a place to postpone correctness testing. The
breakdown is approved and published, with native GitHub parent and dependency links.

## Engineering questions owned by the implementation slices

- Each host must prove that initial and lazy ESM load failures reach a usable
  error path; an import rejection before component mounting is not enough.
  The error UI must remain usable without the failed catalog. Retry/reload
  behavior must respect module-loader caching and host lifecycle constraints.
- The Remix slice begins with a minimal asset-serving, dependency, and failure
  proof. It must use native executable message output, not JSON functions,
  runtime ICU interpretation, or string-to-code evaluation.
- Shared catalog storage must preserve additive load order, overrides, and
  development invalidation while preventing cross-request mutation. Memory
  evidence must include all-used-locale retention and multiple workers.
- Removed runtime APIs/options need exact migration mappings. Runtime parsing
  is not relocated wholesale into another optional application package; only
  demonstrated authoring/tooling needs justify a tooling API.
- Existing source-message identity, locale strategies, supported extraction
  surfaces, platform ranges, and adapter preview tiers remain in force. No
  expansion of catalog import formats or upstream framework support is implied.
  Standalone/custom integrations may use explicit compiled catalogs; the
  standard framework flow must remain automatic.

If a host cannot meet the accepted contract, its slice must surface a concrete
blocker for a focused decision rather than silently retaining legacy behavior.
No additional product decision is currently needed to start the first slices.

## Tracking

- [Palamedes v2 milestone](https://github.com/sebastian-software/palamedes/milestone/1)
- [Epic #1204: compiled runtime and transparent catalog delivery](https://github.com/sebastian-software/palamedes/issues/1204)

The eleven implementation issues are #1205–#1215, attached as native sub-issues
to #1204 with native blocked-by relationships. Existing #1139 and #1144 are
included in the same milestone, retaining their original issue ownership and
scope. They were integrated after reading the complete existing issues and
comments; no replacement tickets were created.

Reconcile the historical
[splitting RFC](2026-08-01-code-splitting-localization-rfc.md) as delivery
decisions are settled rather than treating its exploration as current policy.

## Existing backlog integration — 2026-09-11

Reviewed all fourteen pre-existing open issues (excluding the newly created
v2 epic), including comments. Checked the implementation baseline against
`3e0583dce7d75befd62bca2f5f04b48b95a6afff`, the current upstream main at review
time. Recommendations below distinguish required dependencies from useful
sequencing; open issue text is not assumed to describe current implementation.

| Existing issue                                                                                                             | Position relative to v2                                                                                               | Reason and coordination                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#1139](https://github.com/sebastian-software/palamedes/issues/1139) — sync/async and dual-format compilation coordination | Included in v2; blocks #1215. Prefer before compiler stress validation.                                               | Module-local coordinator/mutation state still exists. Fix the original issue, then reuse its concurrency evidence; it is separate from application runtime catalog sharing. A compatible earlier release is welcome.                                                                                                                     |
| [#1144](https://github.com/sebastian-software/palamedes/issues/1144) — shared configuration helpers and diagnostics        | Included in v2; blocks #1208, #1209, and #1214.                                                                       | New host paths should consume one config dependency/digest implementation instead of copying another. Existing CLI diagnostic polish stays owned here. Can land before the breaking v2 work.                                                                                                                                             |
| [#1154](https://github.com/sebastian-software/palamedes/issues/1154) — CI/release modernization                            | Coordinate before #1215 final release checks; not an all-or-nothing dependency.                                       | Its later comment supersedes the cargo-workspace proposal with the standards rust-node-product template. SHA pins, dependency policy, and local coverage gates have already landed (#1161, #1170); root Cargo/release layout and fuzzing are separate remaining work. Reuse landed changes and avoid a second competing release rewrite. |
| [#1152](https://github.com/sebastian-software/palamedes/issues/1152) — repository guidance/hygiene                         | Parallel maintenance; coordinate ADR path changes after this planning PR or record the existing path as an exception. | Most referenced files and expanded AGENTS.md now exist upstream. Do not recreate them or move ADRs as incidental v2 work. Audit its remaining tasks in its own family workstream.                                                                                                                                                        |
| [#1153](https://github.com/sebastian-software/palamedes/issues/1153) — Cargo metadata/toolchain                            | Mostly implemented; remaining publishing decision separate from v2.                                                   | #1160 added metadata, crate READMEs, workspace lints, edition 2024, dual licensing, and publish guards. Crates.io publication remains explicitly undecided. Do not repeat the completed migration or infer closure of the whole issue.                                                                                                   |
| [#1156](https://github.com/sebastian-software/palamedes/issues/1156) — sibling upgrades/shared extraction                  | Independent; sequence chosen compiler/MDX upgrades before final validation of affected v2 slices.                     | ferralk, ferromark, collation, shared update client, and native scaffolding are several separate changes. Do not make that entire upstream-dependent bundle a v2 blocker. If an upgrade lands, rebase affected compiler/MDX proofs before measuring or releasing.                                                                        |
| [#1150](https://github.com/sebastian-software/palamedes/issues/1150) — family alignment epic                               | Parallel epic, not a child or prerequisite of #1204.                                                                  | Preserve its cross-repository ownership. Its relevant children are coordinated individually above.                                                                                                                                                                                                                                       |
| [#1132](https://github.com/sebastian-software/palamedes/issues/1132) — musl build cache                                    | Useful before repeated v2 platform runs, optional for v2.                                                             | Reduces CI duration, not a runtime/correctness dependency. Reuse improvements if available; do not lower or bypass platform verification.                                                                                                                                                                                                |
| [#1119](https://github.com/sebastian-software/palamedes/issues/1119) — CLI update-check exit latency                       | Independent 1.x bug fix, preferably before extended release/benchmark runs.                                           | The endpoint is embedded in the current release, so the issue's old latent-condition description is stale. Keep network effects out of deterministic v2 checks using existing opt-outs; do not expand the runtime plan into service work.                                                                                                |
| [#1133](https://github.com/sebastian-software/palamedes/issues/1133) — update notice on watch-mode exit                    | Independent maintenance, coordinate with #1119.                                                                       | Shared update-check lifecycle changes should be reviewed together; catalog runtime behavior does not depend on this fix.                                                                                                                                                                                                                 |
| [#1036](https://github.com/sebastian-software/palamedes/issues/1036) — update-check rollout                                | Existing operational follow-up; not a v2 feature or release prerequisite.                                             | Comments record release 1.25.0 and remaining released-client observation. The unsuccessful observation was traced to local DNS restrictions, not established service failure. The remaining operational observation stays owned by #1036.                                                                                                |
| [#855](https://github.com/sebastian-software/palamedes/issues/855) — original update-check proposal                        | Track completion through #1036; no new v2 ticket.                                                                     | Its original Cloudflare and pending-client description is superseded by the canonical rollout and comments in #1036. Preserve operational completion criteria rather than closing it speculatively.                                                                                                                                      |
| [#856](https://github.com/sebastian-software/palamedes/issues/856) — CLI telemetry                                         | Deferred outside v2; after update-check completion and its own product decisions.                                     | Existing triage explicitly defers it and requires separate decisions. Catalog/memory benchmarks here are local engineering verification, not telemetry.                                                                                                                                                                                  |
| [#211](https://github.com/sebastian-software/palamedes/issues/211) — dependency dashboard                                  | Ongoing parallel maintenance.                                                                                         | Coordinate framework/compiler upgrades before the affected host's final proof; do not freeze all dependency work or absorb the dashboard into this release.                                                                                                                                                                              |

Recent merged #1201 and #1202 already optimize runtime/Intl lookups and React/
Solid rendering. V2 starts on top of those changes; server catalog work targets
the still-existing per-message request wrappers, not a repeat of those patches.
