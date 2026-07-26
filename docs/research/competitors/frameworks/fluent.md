---
title: Project Fluent / fluent.js
category: frontend-framework
analyzed: 2026-07-26
analyzed_versions: "@fluent/bundle 0.19.1 (npm, published 2025-04-02); @fluent/react (last npm publish 2023-08-01); fluent.js monorepo state 2026-07-26"
homepage: https://projectfluent.org
repository: https://github.com/projectfluent/fluent.js
---

# Project Fluent / fluent.js

## Fact sheet

| Fact              | Value                                                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------- |
| License           | Apache-2.0                                                                                                      |
| Analyzed version  | @fluent/bundle 0.19.1 (2025-04-02) — still pre-1.0 after ~7 years on npm                                        |
| Company / funding | Mozilla-originated; community-maintained monorepo, no commercial model                                          |
| Pricing           | Free OSS; no product                                                                                            |
| Adoption          | ~73.4k npm downloads/week (@fluent/bundle); ~16.8k (@fluent/react); 1.0k GitHub stars, 80 forks, 62 open issues |
| Framework support | Framework-agnostic core (`@fluent/bundle`), DOM bindings, React bindings                                        |
| Message identity  | Named message IDs in FTL files                                                                                  |
| ICU MessageFormat | **No — deliberately rejected.** FTL is a different syntax with a different philosophy                           |
| .po / gettext     | No — FTL is the format                                                                                          |
| Extraction        | None — FTL files are authored directly                                                                          |
| Notable           | Asymmetric localization: a translation may carry grammatical complexity the source language does not have       |

## Snapshot

- Maintainer / company / funding: originated at Mozilla and ships in Firefox, which is the strongest production credential in this research set. The JavaScript implementation lives in the community `projectfluent/fluent.js` monorepo. No commercial entity or funding model — it is infrastructure, not a product.
- First release / age: `@fluent/bundle` created on npm 2019-07-25, so ~7 years old. Project Fluent itself predates the current package naming.
- Current stable version: `@fluent/bundle` 0.19.1, published **2025-04-02** — roughly 16 months before this analysis, and only **12 published versions in total**. Still on a `0.x` version line after seven years.
- `@fluent/react` was last published **2023-08-01**, nearly three years before this analysis. For a React-facing evaluation this is the single most important fact in the file.
- Adoption: ~73.4k weekly downloads for `@fluent/bundle` — high, but heavily attributable to Firefox-ecosystem and Mozilla-adjacent tooling rather than to application developers choosing it for new React apps. `@fluent/react` at ~16.8k/week is the more honest signal for the React segment.
- Monorepo packages: `@fluent/bundle`, `@fluent/dedent`, `@fluent/dom`, `@fluent/langneg`, `@fluent/react`, `@fluent/sequence`, `@fluent/syntax`.

## Positioning & target audience

- Positions as "a localization framework designed to unleash the expressive power of the natural language" — the pitch is linguistic quality, not developer ergonomics or build performance.
- Targets localization engineers and projects where translation quality into morphologically rich languages is the binding constraint: Mozilla-scale products, government and public-sector software, projects with professional localization teams.
- Explicitly **not** positioned as a fast-moving application-developer product, which is why comparing it on extraction speed or framework matrix would miss what it is for.

## Core concepts & architecture

- **FTL (Fluent Translation List)** is the format: a plain-text syntax with named messages, attributes, terms, selectors and built-in functions, designed to be readable and writable by translators rather than by programmers.
- **Asymmetric localization is the central idea and the real argument against ICU.** In ICU, the message structure is fixed by the source language: if English needs no gender agreement, the message has no gender selector, and a translator into a language that does need it cannot add one without a developer changing the source message. Fluent inverts this — a translation is free to introduce selectors, terms and grammatical complexity that the source never had. The source string stays simple; the Polish or Arabic translation carries whatever machinery that language requires.
- **Terms** allow shared, declinable vocabulary (brand names, product nouns) to be defined once and referenced with grammatical variants across messages.
- Runtime resolution is deliberately fault-tolerant: a broken or missing message degrades rather than throwing, on the theory that a localization bug should never take down a page.
- `@fluent/bundle` is the resolver; `@fluent/dom` binds to DOM nodes declaratively; `@fluent/react` provides React bindings; `@fluent/syntax` is the parser/serializer for tooling.

## Framework & platform support

- Framework-agnostic core plus DOM and React bindings. No first-party bindings for Vue, Svelte, Solid, Angular, or any modern React meta-framework.
- No React Server Components story was found; `@fluent/react` predates the App Router's stabilisation and has not been published since 2023-08-01.

## Catalog formats & interop

- FTL is the format, and there is no `.po`, XLIFF or ICU interchange in the JavaScript packages. `@fluent/syntax` gives tooling a parser, and Pontoon (Mozilla's TMS) speaks FTL natively.
- Interop with the wider localization industry is therefore weaker than gettext or XLIFF in practice — the format is excellent, but the vendor support surface is narrower.

## Workflow & tooling

- Pontoon (Mozilla's own translation platform) is the reference TMS. Broader commercial TMS support for FTL exists but is thinner than for `.po` or XLIFF.
- No extraction tooling: FTL files are authored and maintained directly, so the developer-side workflow is closer to "maintain a resource file" than to "write in components and extract".

## AI features

- None. Project Fluent is a format and a resolver, not a product with an AI layer.

## Pricing

- Free and open source, Apache-2.0. No commercial offering exists.

## Strengths

- **The strongest linguistic argument in the field.** Asymmetric localization is a real, well-reasoned critique of ICU's premise, not a marketing differentiator, and any project claiming "ICU end to end" should be able to answer it.
- Production-proven at scale: Firefox ships it, which is a harder credential than any download count.
- Fault-tolerant by design — a bad translation degrades instead of breaking the UI.
- Terms and attributes model shared, declinable vocabulary in a way ICU has no equivalent for.
- Genuinely translator-oriented syntax, designed with localizers rather than for developers' convenience.

## Weaknesses & criticism

- **Release cadence has effectively stalled for application use.** `@fluent/bundle` has 12 published versions in seven years and last shipped 2025-04-02; `@fluent/react` last shipped 2023-08-01. Still `0.x`.
- No React Server Components support, and no sign of work toward it. For any RSC-first stack this is disqualifying today.
- No modern meta-framework bindings at all — Next.js, TanStack Start, SolidStart, Waku, React Router are all on the application developer.
- Weaker industry interop: FTL has nothing like the vendor support that `.po` and XLIFF enjoy, so the translation supply chain is narrower.
- Asymmetric localization has a real cost, honestly stated: translators can introduce structure the developer never anticipated, which makes the rendered output harder to reason about from the source alone and moves logic into files developers do not review.
- 62 open issues on a 1.0k-star repo with this release cadence suggests a maintenance backlog rather than active product development.

## What they do differently

- **Rejects the ICU premise outright.** Every other project in this research set treats ICU MessageFormat (or its own approximation of it) as the ceiling of expressiveness. Fluent argues the ceiling is in the wrong place: message structure should be owned by the target language, not fixed by the source.
- **Translations may be more complex than their source**, which is the inverse of every extract-and-translate pipeline including Palamedes'.
- **Terms as first-class declinable vocabulary**, shared across messages with grammatical variants.
- **Fault-tolerance as a design principle** rather than an error-reporting strategy.
- **Format-first, not tooling-first**: there is no extraction step, no build integration and no performance story, because the project's thesis is that the hard part of localization is linguistic, not mechanical.

## Sources

- https://registry.npmjs.org/@fluent%2Fbundle (live API, accessed 2026-07-26)
- https://registry.npmjs.org/-/v1/search?text=@fluent/bundle (download counts, live API, accessed 2026-07-26)
- https://registry.npmjs.org/-/v1/search?text=@fluent/react (download counts, live API, accessed 2026-07-26)
- https://github.com/projectfluent/fluent.js (accessed 2026-07-26)
- https://projectfluent.org (returned HTTP 403 to automated fetching; premise described from the fluent.js README and prior knowledge — re-verify before citing specifics, accessed 2026-07-26)
