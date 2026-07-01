# How We Browser-Verify i18n Across Five Frameworks

Status: draft

Cross-framework i18n is easy to claim and hard to prove.

A README can list framework names. A demo can work in one happy path. Neither
tells a maintainer what happens when SSR, locale persistence, client
interaction, and server actions all have to agree.

Palamedes treats that as a verification problem.

The repo contains an example matrix across five framework families:

- Next.js
- TanStack Start
- SolidStart
- Waku
- React Router

Each family has two locale strategies:

- cookie-based locale persistence
- route-segment locale persistence

That gives ten example apps. Each one has browser-visible checks for the parts
that usually hide i18n bugs:

- server-rendered localized text before hydration
- client-side locale switching
- server-side localized action or query output
- the same runtime model behind the framework-specific wiring

The screenshots are versioned in the repo:

- [example screenshots](../../example-screenshots/README.md)
- [matrix visual](../assets/palamedes-localized-matrix.png)

The useful detail is that the screenshots are not hand-picked marketing
images. They come from the same Playwright-based verification flow that checks
the examples.

That changes the value of the asset. The matrix is evidence that the product
thesis is being exercised.

For Palamedes, the thesis is:

> one runtime model, one message identity model, and one catalog workflow can
> stay stable across modern JavaScript app shapes.

The matrix is where that thesis has to survive contact with frameworks.

Next.js and React Router do not fail in the same places. TanStack Start,
SolidStart, and Waku each have their own server/client boundaries. Route-based
locale state and cookie-based locale state put pressure on different parts of
the adapter layer.

That is why this kind of verification is stronger than a single starter app.

It also explains a Palamedes design rule: framework adapters should stay thin.
If each adapter grows its own message semantics, the matrix becomes ten
different products. Palamedes keeps catalog semantics in `ferrocat`, runtime
access behind `getI18n()`, and message identity at `message + context`.

The verifier then checks that every host can express the same model.

This is not the final proof that Palamedes covers every edge case. It is a
repeatable baseline. A team evaluating the project can inspect the examples,
read the screenshots, run the verifier, and see what is already real.

That is the honest version of "works across frameworks."

Not "trust us."

"Run the matrix."

Start here:

- [example matrix](../../../examples/README.md)
- [versioned screenshots](../../example-screenshots/README.md)
- [framework example notes](../../framework-example-notes.md)
