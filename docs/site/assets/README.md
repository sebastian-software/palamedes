# Site Assets

## `palamedes-localized-matrix.png`

The README hero. It shows one example demo rendered in three locales side by
side, so the localization story is visible at a glance: switch language and the
copy, plural seat counts, currency, and dates all change together.

It intentionally shows a single framework. Every framework and locale strategy
renders the same design, so repeating ten near-identical screenshots would add
noise, not proof. The per-framework, per-strategy captures live in
[`docs/example-screenshots`](../../example-screenshots) and are what CI
regenerates.

It is public-facing proof generated from a real, running build, not a
hand-drawn mockup. Regenerate it by serving any example and running the
builder against its port:

```bash
pnpm --filter @palamedes/example-tanstack-cookie build
pnpm --filter @palamedes/example-tanstack-cookie preview &
node scripts/build-readme-hero.mjs --port 4020 --out docs/site/assets/palamedes-localized-matrix.png
```
