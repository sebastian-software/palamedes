# Palamedes Website Structure

This directory is the design source for the public Palamedes homepage. It
describes page structure, layout, and copy using **pseudo-JSX**: the files look
like React components, but they are a specification, not runnable code. The
goal is that a designer or implementer can read one page file top-to-bottom and
know exactly what sections exist, in which order, with which copy, and which
links they carry.

## How to read the pseudo-JSX

- Every `pages/*.jsx` file is one route of the site.
- Components like `<Hero>`, `<ProofStrip>`, `<CodeShowcase>` are layout
  primitives. Their intended anatomy and props are defined once in
  [`components.jsx`](components.jsx).
- All visible copy is real, final-draft copy — not lorem ipsum. Copy edits
  happen here first, then flow into the implementation.
- `href` values use site-relative routes (`/proof`, `/frameworks`) for internal
  pages and full URLs for repo/docs/demo links.
- Comments (`{/* ... */}`) carry layout intent (grid columns, emphasis,
  responsive behavior) that markup alone cannot express.

## Sitemap

| Route          | File                                             | Job of the page                                                        |
| -------------- | ------------------------------------------------ | ---------------------------------------------------------------------- |
| `/`            | [`pages/HomePage.jsx`](pages/HomePage.jsx)       | Convert: one model across frameworks, proof-first, clear next step     |
| `/frameworks`  | [`pages/FrameworksPage.jsx`](pages/FrameworksPage.jsx) | Show the 5×4 verified matrix and live demos per framework       |
| `/proof`       | [`pages/ProofPage.jsx`](pages/ProofPage.jsx)     | Benchmarks, verification story, screenshots — the evidence page        |
| `/get-started` | [`pages/GetStartedPage.jsx`](pages/GetStartedPage.jsx) | The 5-minute path from install to first rendered translation    |
| `/compare`     | [`pages/ComparisonPage.jsx`](pages/ComparisonPage.jsx) | Honest positioning vs Lingui, next-intl, and GT                  |
| `/blog`        | [`pages/BlogIndexPage.jsx`](pages/BlogIndexPage.jsx)   | Founder-led posts; reuses `docs/site/posts/`                     |

Every page shares `<SiteNav>` and `<SiteFooter>` from `components.jsx`.

## Messaging rules this structure follows

These come from [`docs/site/comparison.mdx`](../comparison.mdx),
[`docs/site/proof.mdx`](../proof.mdx), and
[`docs/principles.md`](../../principles.md):

1. **Proof before promise.** Every quantitative claim links to a checked-in
   report or a verifiable repo artifact. No benchmark number without a
   methodology link.
2. **No "Rust means fast" shortcut.** Rust is mentioned as the reason the
   careful work has one home; speed claims cite the e2e benchmark only.
3. **Competitors are framed, not trashed.** Lingui is the closest neighbor,
   next-intl is a better fit for some teams, GT is a different category.
4. **Current-state honesty.** The top-level `palamedes` / `create-palamedes`
   packages are reserved names, not the install path — the site must not
   pretend otherwise.

## Relationship to the homepage-direction planning (issue #290)

Issue [#290](https://github.com/sebastian-software/palamedes/issues/290)
explores ten visual directions and the Core vs. Palamedes+ leading question.
This structure is deliberately **visual-direction-agnostic**: it fixes the
information architecture, section order, and copy, and can be skinned with any
of the explored directions. Two decisions from #290 affect this structure and
must be resolved before implementation:

1. **Core-led vs. Plus-led homepage.** The current `HomePage.jsx` is Core-led
   (open-source proof first). If Plus leads instead, the hero and one section
   swap, but subpages stay valid.
2. **Palamedes+ page.** If Plus positioning is confirmed, add a `/plus` route
   (managed AI translation, glossary/protected terms, QA, writeback) — kept
   out of this pass because the copy must not overstate what exists today.

## Facts the copy relies on (verify before shipping)

- 20 browser-verified example apps: 5 framework families × 4 locale
  strategies (cookie, route, subdomain, TLD) — see `examples/`.
- Live demos referenced as `*.examples.palamedes.dev` — note: the repo's
  deploy tooling currently targets differently named `vercel.app` hosts, and
  `docs/demo-deployments.md` marks the subdomain/tld rows as not yet
  reachable. The demo-URL story must be reconciled before the site ships
  (tracked in the docs-audit epic).
- E2E extract/update benchmark medians: 33.53 ms (small), 42.92 ms (medium);
  19.59× vs Lingui, 14.24× vs i18next-parser on the checked machine-local run
  — see `benchmarks/e2e-workflow/results/latest.md`.
- 16 ADRs in `adr/`.
- CLI binary is `pmds`; recommended install is the scoped `@palamedes/*`
  packages.
