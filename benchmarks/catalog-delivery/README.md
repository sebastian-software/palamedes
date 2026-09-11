# Palamedes v2 catalog delivery evidence

This document records reproducible fixture checks for the Palamedes v2
compiled runtime and adapter-owned catalog delivery contract. The measurements
describe the checked source revision and verification commands; they are not a
production performance claim.

## Verification scope

The regular browser matrix covers 22 host entries. It checks the healthy
initial document, active-locale selection, hydration, interaction, and locale
navigation paths. The separate React Router RSC proof covers its server and
browser graphs and request-scope behavior. The smoke gate covers all 25
repository examples.

Fault proofs are representative by framework: cookie examples exercise
initial and lazy catalog dependency failures, including ordinary host error UI
and reload recovery. Waku additionally exercises initial production failures
for all four locale strategies, plus the cookie fixture's lazy development
failure and recovery path. Waku's CSP positive controls cover the cookie and
route strategies; mapped-host subdomain and TLD checks are reported as
mapped-host delivery checks rather than CSP results.

The matrix preserves the declared framework support tiers and locale
strategies. It does not imply that every failure phase is repeated for every
strategy, or that the examples form one combined application.

## Reproduction

Run these commands from the repository root after a frozen dependency install:

```bash
pnpm agent:check
pnpm verify:examples:smoke
pnpm verify:examples:browser
pnpm verify:react-router-rsc
pnpm --filter @palamedes/example-nextjs-cookie test:rsc-scope
pnpm --filter @palamedes/example-nextjs-cookie test:rsc-scope:webpack
pnpm --filter @palamedes/example-nextjs-cookie test:message-splitting:development
pnpm benchmark:server-catalog
```

`agent:check` is the repository-wide build, test, type, lint, formatting,
published-surface, and Rust gate. The two Next commands rebuild the cookie
fixture and run its request-scope proof with Turbopack and webpack
respectively. The RSC command is a separate proof because its graph and
transport differ from the regular browser matrix.

## Server catalog evidence

The checked-in [server catalog benchmark](../server-catalog/README.md) uses
eight locales, 2,000 constant messages per locale, and 2,000 retained request
instances. Its shared-content run reports a retained heap delta of 2,886,632
bytes. The copied-map comparison reports a retained heap delta of 199,885,984
bytes and 4,000,000 allocated message entries.

The benchmark instruments catalog enumeration during request creation and
exercises mixed-locale and concurrent cold calls, warmed reuse, invalidation,
ESM retention, and two worker processes. These are local fixture measurements:
they exclude network latency, use constant messages rather than a
representative rich-message distribution, and are not a production throughput
or memory promise. The copied-map case isolates catalog duplication and is not
a measurement of an earlier Palamedes release.

## Browser artifact and response measurements

The artifact scan checks every emitted `.js`, `.mjs`, and `.cjs` file in the
complete browser graph, including unused locale and lazy chunks. It rejects
application parser markers and records decoded file bytes plus the sum of
`gzipSync` sizes calculated independently for each file. These are build
artifact estimates. They are not Content-Length values, wire transfer bytes,
compressed responses observed from a server, Brotli measurements, or a
before/after regression comparison. Source maps are not part of this scan.

The browser observer records only successful responses with a JavaScript
Content-Type. It reads decoded JavaScript response bodies and checks them for
parser markers while the ordinary host interaction runs. It excludes HTML,
inline scripts, RSC/Flight transport, CSS, images, fonts, headers, and failed
responses. Its decoded-byte sum can include repeated URL responses during
navigation or reload; `uniqueModuleUrls` is recorded separately and does not
turn the byte sum into deduplicated transfer size. Next catalog bytes remain
`null` where catalog code cannot be attributed separately from hashed bundles.

Do not report these fields as total-page payload, network-wire bytes,
deduplicated payload, or a comparison with another implementation. Do not add
a framework ranking or a total across examples; each fixture has its own graph,
locale set, and host behavior.

## Representative host measurements

The completed run produced 23 network JSON files and 22 artifact JSON files.
A dash denotes a measurement that is not emitted or separately attributable.
All sizes below are bytes.

| Host                    | Initial JS responses / unique / decoded bytes | Observed JS responses / unique / decoded bytes | Artifact files / decoded bytes / gzip estimate | Catalog bytes |
| ----------------------- | --------------------------------------------: | ---------------------------------------------: | ---------------------------------------------: | ------------: |
| nextjs-cookie           |                              13 / 13 / 486944 |                               26 / 16 / 973859 |                           33 / 661014 / 210278 |             — |
| react-router-cookie     |                              12 / 12 / 345818 |                               24 / 16 / 691606 |                           26 / 357742 / 118806 |          5148 |
| react-router-rsc-cookie |                              11 / 11 / 331291 |                               13 / 13 / 332026 |                           21 / 333195 / 107668 |           259 |
| remix-cookie            |                              54 / 54 / 281407 |                               57 / 56 / 282516 |                                              — |          1949 |
| tanstack-cookie         |                                7 / 7 / 348677 |                               12 / 12 / 351237 |                           21 / 355010 / 116004 |          5151 |
| vite-mdx                |                                6 / 6 / 209370 |                                 9 / 9 / 212171 |                             9 / 212171 / 68510 |          5365 |
| waku-cookie             |                                8 / 8 / 268243 |                               16 / 12 / 536453 |                            29 / 276061 / 91309 |          4065 |
| solid-cookie            |                              10 / 10 / 119258 |                               20 / 16 / 238480 |                            28 / 150190 / 57411 |          5314 |

The generated [catalog-delivery JSON](./2026-09-11.json) is the source for the
table. The network observer includes successful responses with a JavaScript
Content-Type only. It excludes HTML, inline JavaScript, RSC/Flight, CSS,
images, fonts, headers, and failed responses.

## Verification record

The full smoke matrix (25 examples), regular browser matrix (22 hosts), and
separate React Router RSC proof completed successfully on 2026-09-11 with
Node 24.15.0 on macOS arm64. All commands exited with status 0.

- Matrix source revision: `62cca6dc356ccb4f708bc90887116ba9fdc1c039`
- Final Solid script-attribute hardening: all four smoke/browser proofs and
  focused package/type checks passed at `9695c58c115a3f797cc701a350bc801fda5734c6`.
  The JSON contains the refreshed Solid measurements.
- Full `pnpm agent:check`: passed at `727fa540617b95c8bb105f7485cb194528ac3fc8`;
  subsequent Solid cleanup passed its focused tests and formatting checks.
- Next request-scope proofs: both Turbopack and webpack passed, including
  mixed-locale RSC requests, Server Actions and development updates.
- Rust formatting, all-feature Clippy and the locked workspace tests passed.
- Generated artifact: [`2026-09-11.json`](./2026-09-11.json)

The runtime and adapter contract is defined by the [v2 migration
guide](../../docs/migration-v2.md), [ADR-008](../../adr/008-framework-adapter-architecture.md),
[ADR-022](../../adr/022-generated-catalogs-use-executable-message-functions.md),
and [ADR-023](../../adr/023-generated-production-runtime-is-parser-free.md).

These checks do not publish packages or enable release publication. The
repository release hold remains active until the final evidence and release
gates have been reviewed.
