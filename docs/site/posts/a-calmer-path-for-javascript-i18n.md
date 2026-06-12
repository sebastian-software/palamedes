# A Calmer Path For JavaScript i18n

Status: draft

JavaScript i18n usually starts small.

A team adds a translation helper, a few message files, and a locale switcher.
Then the app changes shape. A route moves to the server. A framework adds a
new rendering mode. A product team asks for a second frontend. The original
i18n choice starts leaking through the codebase.

Palamedes is built around a narrower idea: keep the translation model steady
while the app changes around it.

That means three things.

First, messages stay close to the code. You write the source message where the
UI happens, then extract it into source-string-first `.po` catalogs. A
source-string-first catalog means the English source sentence remains the
primary identity translators can inspect. There is no separate key namespace to
invent before the product language exists.

Second, identity is `message + context`. The same sentence can mean different
things in different places, so Palamedes treats context as part of the message
identity. That is the model behind gettext-style workflows, and it stays useful
in modern component systems.

Third, runtime access goes through one model: `getI18n()`. Framework adapters
can be small because the application-facing runtime shape does not need to be
relearned for every host.

The technical implementation matters because it protects that product shape.
The Rust core, OXC-powered transforms, and `ferrocat` catalog semantics are not
there so the homepage can say "Rust-powered." They are there so parsing,
extraction, catalog updates, audits, ICU checks, and runtime artifact
compilation have one clear home.

That is what makes the system calmer in practice.

The proof is visible in the repo:

- the [example matrix](../../../examples/README.md) covers Next.js, TanStack
  Start, SolidStart, Waku, and React Router
- each framework family has cookie and route locale strategies
- [browser screenshots](../../example-screenshots/README.md) are generated
  from the same Playwright verification flow used in CI
- [ADRs](../../../adr/001-project-scope-and-positioning.md) explain the runtime
  model, message identity, adapter architecture, and native boundary
- [benchmark commands](../../proof-and-benchmarks.md) are checked in so local
  measurements can be rerun

The point is not that Palamedes already does everything. It does not. There is
no top-level `palamedes` install path yet, and the repo says that plainly.

The point is that the core model is already coherent enough to verify across
very different hosts. That matters more than a clever API surface. Teams do
not adopt i18n tooling for a weekend. They adopt it into codebases that will
outlive the current framework preference.

If that is the evaluation frame, the question changes.

It is not "which tool has the most impressive demo?"

It is "which tool keeps the fewest moving parts in my head when the app
changes?"

That is the lane Palamedes is built for.

Start with the [5-minute quickstart](../../first-working-translation.md), then
read the [proof and benchmark page](../../proof-and-benchmarks.md).
