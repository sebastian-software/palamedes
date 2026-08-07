---
date: "2026-07-05"
---

# How We Browser-Verify i18n Across Five Frameworks

Status: draft

Cross-framework i18n is easy to claim and hard to prove.

A README can list framework names. A demo can work in one happy path. Neither
tells a maintainer what happens when SSR, locale persistence, client
interaction, and server actions all have to agree.

Palamedes treats that as a verification problem.

The repo contains 25 examples: six server framework families with four locale
strategies each, plus a focused Vite MDX app. All 25 are smoke-checked on
relevant pull requests and `main` pushes.

This article is about the 20 established UI-adapter examples that share the
browser interaction contract and versioned screenshots:

- Next.js
- TanStack Start
- SolidStart
- Waku
- React Router

Each family has four locale strategies:

- cookie-based locale persistence
- route-segment locale persistence
- subdomain-based locale persistence
- top-level-domain locale persistence

That gives 20 UI-adapter example apps. Each one has visible checks for the parts that
usually hide i18n bugs:

- server-rendered localized text before hydration
- document-level locale switching
- server-side localized action or query output
- the same runtime model behind the framework-specific wiring

Those 20 UI-adapter examples have two versioned screenshots each:

- [example screenshots](../../../docs/example-screenshots/README.md)
- [matrix visual](../../../docs/assets/palamedes-localized-matrix.png)

The useful detail is that the screenshots are not hand-picked marketing
images. They come from the same Playwright-based verification flow that checks
those UI-adapter examples weekly and on manual dispatch. The browser lane also
checks the Vite MDX app; the four server-first Remix v3 examples remain
smoke-only and have no browser capture.

That changes the value of the asset. The matrix is evidence that the product
thesis is being exercised.

For Palamedes, the thesis is:

> one runtime model, one message identity model, and one catalog workflow can
> stay stable across modern JavaScript app shapes.

The matrix is where that thesis has to survive contact with frameworks.

Next.js and React Router do not fail in the same places. TanStack Start,
SolidStart, and Waku each have their own server/client boundaries. Remix v3 is
covered separately by the smoke lane while its UI adapter settles.
Route-based locale state and cookie-based locale state put pressure on different
parts of the adapter layer.

That is why this kind of verification is stronger than a single starter app.

It also explains a Palamedes design rule: framework adapters should stay thin.
If each adapter grows its own message semantics, the matrix becomes ten
different products. Palamedes keeps catalog semantics in `ferrocat`, runtime
access behind `getI18n()`, and message identity at `message + context`.

The browser verifier checks that each UI-adapter host can express the same
model, while the smoke lane covers the full 25-example matrix.

This is not the final proof that Palamedes covers every edge case. It is a
repeatable baseline. A team evaluating the project can inspect the examples,
read the screenshots, run the verifier, and see what is already real.

That is the honest version of "works across frameworks."

Not "trust us."

"Run the matrix."

Start here:

- [example matrix](../../../examples/README.md)
- [versioned screenshots](../../../docs/example-screenshots/README.md)
- [framework example notes](../../../docs/framework-example-notes.md)
