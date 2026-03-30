# Comparing Modern i18n Approaches

Not every modern JavaScript i18n library should be compared in the same way.

Some tools share the same authoring model and the same build-time hot paths.
Others solve more of the translation workflow, stay closer to runtime
dictionary lookup, or lean heavily on framework-specific loaders and plugins.

This page exists to make that distinction explicit and to explain where
Palamedes actually sits in the market.

The shortest answer is this:

Palamedes is for teams that want compile-time authoring, source-string-first
semantics, and a cleaner architecture that stays coherent across framework
boundaries.

## Why Lingui Gets The Head-to-Head Benchmark

Palamedes and Lingui are the cleanest direct comparison in this repo because
they overlap on the same core layers:

- compile-time authoring syntax close to the source file
- source analysis and message extraction
- catalog-driven workflows
- a separate step that turns catalogs into runtime-ready data

That does not mean the two systems are identical. Lingui carries a broader
historical surface and more legacy accommodation. Palamedes is narrower on
purpose. But they are still close enough that a direct benchmark says
something real.

That is why this repo publishes a machine-local benchmark against Lingui v6
Preview and does not pretend that every other i18n tool belongs in the same
timing chart.

## Palamedes

Palamedes is built around a simple claim: the more important the i18n hot path
becomes, the less it should be scattered across unrelated layers.

In practice, that means most of the semantic heavy lifting lives in a native
Rust core. Macro rewrite, extraction, and catalog artifact work are centered
there, while host adapters stay deliberately thin. Publicly, Palamedes also
stays opinionated on identity: `message + context` is the model, not a pile of
manually maintained IDs.

That gives Palamedes a narrower product shape than some alternatives, but it
also makes the system easier to reason about. There is less ambiguity about
which layer owns which decision.

That is also why the cross-framework story matters. Palamedes is unusual not
because it has more than one adapter. It is unusual because the same runtime
and identity model survive across verified integrations for Next.js, TanStack
Start, Waku, and React Router.

The performance story follows from that architectural discipline more than from
“Rust” as a branding point.

## Lingui

Lingui is Palamedes' closest conceptual neighbor.

It got an important instinct right early: authoring-facing syntax, extracted
catalogs, and practical framework integration are better than ad hoc
translation sprawl. That is the main reason Palamedes can feel familiar to
Lingui users while still taking a stricter architectural position underneath.

As of March 19, 2026, Lingui v6 Preview exposes both a Babel macro path and an
SWC plugin path. That matters for benchmarking because Lingui and Palamedes are
not just similar in API flavor, they both spend real time in compile-time
rewrite and extract flows. In this repo's current machine-local runs, Palamedes
remains clearly ahead on both Lingui transform lanes as well as extraction,
which reinforces the broader architectural point: centralizing the hot path in
a tighter native core changes real developer-facing latency, not just
implementation aesthetics.

The exact methodology and current machine-local outputs live in the dedicated
Lingui benchmark page, because the numbers only make sense when read together
with their scope and validation rules.

The practical difference is less “Lingui is old, Palamedes is new” and more
this: Lingui has broader compatibility pressure, while Palamedes is willing to
be narrower so the core can stay cleaner.

## next-intl

`next-intl` should not be framed as “basically Lingui for Next.js.” Its default
model is different.

The main `next-intl` path is runtime- and message-file-first. You keep
structured message files, then consume them through APIs like `useTranslations`.
That keeps the mental model straightforward for teams that want message
catalogs to remain the center of gravity.

At the same time, `next-intl` has clearly moved closer to some of the same
problems Palamedes and Lingui care about. On November 7, 2025 it introduced
`useExtracted`, an inline-message authoring API that rewrites source usage
toward `useTranslations`, keeps catalogs in sync, and leans on framework loader
infrastructure. On January 28, 2026 it added ahead-of-time ICU message
compilation through `icu-minify`, moving message parsing out of the runtime and
into the build.

Those additions are important because they show convergence, but not
equivalence.

`useExtracted` overlaps partly with source rewrite and partly with catalog
maintenance. `precompile` overlaps with a pure message-compile step. Neither
feature maps cleanly to Palamedes as a whole, because `next-intl` still centers
a different end state: Next.js-native plugin infrastructure, generated/minified
identities in the extracted flow, and a stronger message-file-first posture
overall.

So `next-intl` belongs in an architectural comparison, and some of its
sub-steps may eventually deserve isolated micro-benchmarks. But treating it
like a clean end-to-end benchmark peer to Palamedes would overstate how much of
the stack is actually shared.

## General Translation (GT)

GT is interesting precisely because it is not just an i18n library.

It includes a Rust-based SWC compiler for analysis and optional compile-time
hashes, but that is only one part of the picture. Its bigger idea is build-time
translation for content that is known before deploy, plus a wider product
surface around template generation, local files, hosted translation, and
dynamic translation paths for content that cannot be fixed ahead of time.

That makes GT broader in product scope and less clean as a direct benchmark
target.

If you compare GT's compiler to Palamedes, you are only comparing one slice of
what GT is trying to do. If you compare GT's translation workflow to Palamedes,
you are no longer comparing the same category of product at all. GT is much
closer to an integrated translation system with local-library escape hatches
than to a narrowly scoped compile-and-runtime architecture.

Still, GT is worth studying because it points at adjacent product opportunities.
Its local template generation for inline-authored strings, richer translator
context, and explicit separation between local runtime behavior and optional
translation services are all useful signals. They do not invalidate Palamedes'
current design. They suggest where Palamedes could expand later without
abandoning its core discipline.

## The Honest Comparison

If a team wants the closest direct alternative to Palamedes today, Lingui is
the answer.

If a team wants a Next.js-native message-file workflow with newer compile-time
conveniences layered in, `next-intl` is a better mental model.

If a team wants not just i18n runtime behavior but also a broader
translation-generation workflow, GT is solving a bigger and more
service-oriented problem.

Palamedes sits in a more specific place than all three:

it is for teams that like compile-time authoring, want source-string-first
semantics, and care enough about toolchain architecture that they are willing
to prefer a narrower but cleaner system.

It is also for teams that care about not having their i18n strategy become
framework-fragmented as the application evolves.

That is the right way to read the benchmark story as well. The Lingui benchmark
is not meant to imply that every i18n library should be forced into the same
race. It exists because Lingui and Palamedes actually run on comparable hot
paths. The broader comparison with `next-intl` and GT is better handled as an
explanation of product shape, semantic choices, and architectural tradeoffs.

## Further Reading

- [Comparison with Lingui](https://github.com/sebastian-software/palamedes/blob/main/docs/comparison-with-lingui.md)
- [Benchmarking against Lingui v6 Preview](https://github.com/sebastian-software/palamedes/blob/main/docs/benchmark-lingui-v6-preview.md)
- [next-intl `useExtracted`](https://github.com/amannn/next-intl/blob/main/docs/src/pages/blog/use-extracted.mdx)
- [next-intl ICU precompilation RFC](https://github.com/amannn/next-intl/blob/main/rfcs/002-icu-message-precompilation.md)
- [General Translation compiler docs](https://generaltranslation.com/en/docs/next/concepts/compiler)
- [General Translation `useGT`](https://www.generaltranslation.com/docs/react/api/strings/use-gt)
- [General Translation standalone i18n](https://generaltranslation.com/docs/next/concepts/stand-alone)
