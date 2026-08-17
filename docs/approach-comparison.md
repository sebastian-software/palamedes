# Comparing Modern i18n Approaches

Not every modern TypeScript i18n library should be compared in the same way.

Some tools share the same authoring model and the same build-time work.
Others solve more of the translation workflow, stay closer to runtime
dictionary lookup, or lean heavily on framework-specific loaders and plugins.

This page exists to make that distinction explicit and to explain where
Palamedes actually sits.

The shortest answer is this:

Palamedes is for teams that want compile-time authoring, source-string-first
catalogs, and one coherent i18n model from source to runtime. First-party
adapters connect that model to supported hosts.

## Why Lingui Gets The Head-to-Head Benchmark

Palamedes and Lingui are the cleanest direct comparison in this repo because
they overlap on the same core layers:

- compile-time authoring syntax close to the source file
- source analysis and message extraction
- catalog-driven workflows
- a separate step that turns catalogs into runtime-ready data

That does not mean the two systems are identical. Lingui carries a broader
historical surface and more legacy accommodation. Palamedes chooses one
supported path for each core concern. But they are still close enough that a
direct benchmark says something real.

That is why this repo keeps a machine-local benchmark harness against Lingui v6
and does not pretend that every other i18n tool belongs in the same
timing chart.

## Palamedes

Palamedes is built around an opinionated claim: the more important translation
work becomes, the less it should be scattered across unrelated layers.

In practice, that means most of the semantic heavy lifting lives in a native
Rust core. Macro rewrite, extraction, and catalog artifact work are centered
there, while host adapters stay deliberately thin. Publicly, Palamedes also
stays opinionated on identity: `message + context` is the model, not a pile of
manually maintained IDs.

That gives Palamedes a broad toolchain with clear ownership rather than several
overlapping ways to solve the same concern. There is less ambiguity about which
layer owns which decision.

That is also why the framework matrix matters. Palamedes is unusual not because
it has more than one adapter, but because the same runtime and identity model
are verified across Next.js, TanStack Start, SolidStart, Waku, React Router,
and Remix, with Vite MDX as the client-only proof. The matrix is evidence of
the architecture, not a requirement that one team use several frameworks. It
follows the integration model covered in
[the detailed Lingui comparison](./comparison-with-lingui.md#the-real-positioning).

The performance story follows from that discipline more than from "Rust" as a
branding point.

## Lingui

Lingui is Palamedes' closest conceptual neighbor.

It got an important instinct right early; [the detailed
comparison](./comparison-with-lingui.md#the-real-positioning) spells out what
that instinct consists of. It is the main reason Palamedes can feel familiar to
Lingui users while still taking a stricter architectural position underneath.

Lingui v6 exposes both a Babel macro path and an SWC plugin path. That matters
for benchmarking because Lingui and Palamedes share more than API flavor: both
spend real time in compile-time rewrite and extract flows. Keep any competitive
speed claim tied to checked-in benchmark output; this page should not state a
current Lingui comparison without a report in `benchmarks/lingui-v6/results/`.

The methodology lives in the dedicated Lingui benchmark page. Current outputs
belong in the benchmark results directory before they are summarized here.

The practical difference is less "Lingui is old, Palamedes is new" and more
this: Lingui has broader compatibility pressure, while Palamedes is willing to
retire overlapping paths so the core can stay coherent.

## next-intl

`next-intl` should not be framed as "basically Lingui for Next.js." Its default
model is different.

The main `next-intl` path is runtime- and message-file-first. You keep
structured message files, then consume them through APIs like `useTranslations`.
That keeps the mental model straightforward for teams that want message
catalogs to remain the center of gravity.

At the same time, `next-intl` has moved closer to some of the same problems
Palamedes and Lingui care about. Its `useExtracted` work introduces an
inline-message authoring path that rewrites source usage toward
`useTranslations`, keeps catalogs in sync, and leans on framework loader
infrastructure. Its ahead-of-time ICU compilation work moves message parsing
out of the runtime and into the build. Pin exact dates inline only when the
source links are present next to the claim.

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

## General Translation

General Translation is interesting precisely because it is broader than an i18n
library.

It includes a Rust-based SWC compiler for analysis and optional compile-time
hashes, but that is only one part of the picture. Its bigger idea is build-time
translation for content that is known before deploy, plus a wider product
surface around template generation, local files, hosted translation, and
dynamic translation paths for content that cannot be fixed ahead of time.

That makes General Translation broader in product scope than Palamedes. It does
not, however, make General Translation unmeasurable: `gtx-cli generate`
extracts from source and merges the configured locale catalogs entirely
locally, with no API key and no network access, which is why it has its own lane
in the [end-to-end workflow benchmark](./benchmark-e2e-workflow.md). General
Translation documents that command for teams handling their own translations;
its default path (`gtx-cli translate`) sends content to the General Translation
API and is a different category of operation that the benchmark deliberately
leaves alone.

So the comparison has to name which part of General Translation you mean.
Comparing General Translation's compiler to Palamedes covers one slice of what
General Translation is trying to do. Comparing General Translation's hosted
translation workflow to Palamedes compares two different products. Comparing
`gtx-cli generate` to `pmds extract` is a fair like-for-like on the local
extract-and-update step, and that is the only General Translation comparison
this repository makes numerically. Beyond that step General Translation
remains much closer to an integrated translation system with local-library
escape hatches than to a narrowly scoped compile-and-runtime architecture.

Still, General Translation is worth studying because it points at adjacent
product opportunities. Its local template generation for inline-authored
strings, richer translator context, and explicit separation between local
runtime behavior and optional translation services are all useful signals. They
do not invalidate Palamedes' current design. They suggest where Palamedes could
expand later without abandoning its core discipline.

## The Honest Comparison

If a team wants the closest direct alternative to Palamedes today, Lingui is
the answer.

If a team wants a Next.js-native message-file workflow with newer compile-time
conveniences layered in, `next-intl` is a better mental model.

If a team wants i18n runtime behavior plus a broader translation-generation
workflow, General Translation is solving a bigger and more service-oriented
problem.

Palamedes combines broad local workflow coverage with a specific, opinionated
model:

it is for teams that like compile-time authoring, want source-string-first
catalogs, and prefer one clear path from source to runtime.

Its first-party adapters keep supported host integrations from redefining that
local model as the application evolves.

## ICU As A Pipeline Contract

ICU support is not a useful yes/no checkbox by itself. A library may use ICU
natively or through a plugin; a translation platform may edit the raw message,
split it into forms, convert it into another model, or only validate it.

Palamedes therefore makes a bounded claim about the stages it owns: nested ICU
selectors remain intact from source through extraction, macro transformation,
PO catalog update, catalog compilation, and runtime rendering. That claim has
a checked fixture and command instead of relying on a vendor comparison:

```bash
pnpm proof:icu
```

See [ICU Semantics Proof: Source to Runtime](./icu-semantics-proof.md) for the
reproducible proof, the exact claim boundary, and a dated snapshot of public
React Intl, i18next, Crowdin, Phrase, and Weblate documentation.

That is the right way to read the benchmark story as well. The Lingui benchmark
is not meant to imply that every i18n library should be forced into the same
race. It exists because Lingui and Palamedes actually run on comparable
operations, and the same test decides every other lane: General Translation
earns a measured row because `gtx-cli generate` is a comparable local
operation, while `next-intl` does not, because its extraction only exists
inside a bundler build. Where the operations do not line up, the comparison
belongs in product shape, semantic choices, and architectural tradeoffs instead
of in a number.

## Further Reading

- [Comparison with Lingui](./comparison-with-lingui.md)
- [Benchmarking against Lingui v6 Preview](./benchmark-lingui-v6-preview.md)
- [next-intl `useExtracted`](https://github.com/amannn/next-intl/blob/main/docs/src/pages/blog/use-extracted.mdx)
- [next-intl ICU precompilation RFC](https://github.com/amannn/next-intl/blob/main/rfcs/002-icu-message-precompilation.md)
- [General Translation compiler docs](https://generaltranslation.com/en/docs/next/concepts/compiler)
- [General Translation `useGT`](https://www.generaltranslation.com/docs/react/api/strings/use-gt)
- [General Translation standalone i18n](https://generaltranslation.com/docs/next/concepts/stand-alone)
