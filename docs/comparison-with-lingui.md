# Palamedes vs. Lingui

Lingui is one of the better i18n systems in the JavaScript ecosystem. A lot of what matters in Palamedes was shaped by the same instincts: macro-based authoring, extracted catalogs, and pragmatic framework integration.

Palamedes is not "Lingui with a new coat of paint," though. It takes the same core direction and pushes it to a clearer end state: a native core, thinner JavaScript layers, a stricter runtime model, and less historical API drag.

If you are starting fresh or already doing architecture cleanup, Palamedes is the better default in our view.

## Quick Comparison

| Topic | Lingui | Palamedes |
| --- | --- | --- |
| Core idea | Strong macro-based i18n workflow | Same core idea, but with a tighter architecture |
| Transform core | More historically shaped by JS and Babel | Native Rust core with thin TypeScript wrappers |
| Message identity | Broader historical API surface | Strictly source-string-first: `message + context` |
| Runtime model | Multiple grown-over-time access paths | One public model: `getI18n()` |
| Framework integration | Good, but more shaped by Lingui's existing model | Thin Vite and Next.js adapters over the native core |
| Source maps | Part of the toolchain stack | Always part of transform output |
| Product direction | Broad compatibility pressure | Opinionated, narrower, cleaner end state |

## Why We Think Palamedes Is the Better Default

### 1. Same strong idea, cleaner architecture

Lingui got the big idea right early: macros, extracted messages, and catalog-driven workflows are better than scattering translation strings across an app by hand.

Palamedes keeps that part. What it drops is a lot of the architectural weight that builds up over time in mature ecosystems. The semantic core lives in Rust, the TypeScript layer stays thinner, and the transform story is no longer spread across multiple partially overlapping implementations.

That makes the system easier to understand, easier to maintain, and easier to evolve.

### 2. One runtime model instead of several

Palamedes standardizes on one runtime access model: `getI18n()`.

That is not just a rename. It removes the old split between multiple access styles and makes the real question explicit: how does this environment provide the active i18n instance?

The result is straightforward:

- fewer mental branches
- clearer transform output
- fewer client/server special cases

### 3. Native core instead of growing JavaScript side paths

Palamedes now does transform, extraction, and catalog work through a native core. TypeScript still matters, but it is no longer carrying a second copy of product semantics.

That pays off in a few ways:

- less duplicated logic
- less drift between "main path" and fallback behavior
- clearer ownership in the codebase
- a cleaner path to packaging, benchmarking, and release work

### 4. Better end-state discipline

Lingui has to account for a large existing ecosystem. That is normal, and often the right trade-off.

Palamedes does not have the same historical burden. That gives it room to finish decisions instead of carrying half-migrated states indefinitely:

- old access paths do not need to live forever
- transform and extractor behavior can be designed toward a single target state
- API surfaces can get smaller instead of only growing

If you want a modern i18n toolchain for a new codebase, that is an advantage.

## Where Palamedes Is Concretely Better

### Native transform and extraction core

Palamedes uses Rust for:

- macro transforms
- message extraction
- PO parsing and catalog updates
- catalog parsing and normalization through `ferrocat`

That removes a lot of JavaScript infrastructure from the hottest part of the toolchain.

### Cleaner message model

Palamedes treats `message + context` as the only semantic identity.

That means:

- no author-facing explicit IDs
- source-string-first catalogs and diagnostics
- compact hash keys only as internal compile/runtime artifacts

That is closer to gettext, and cleaner than mixing source strings with a second public ID model.

### Source maps by default

Source maps are not an optional side concern in Palamedes. If the transform rewrites code, it emits source maps.

That matters for:

- Vite integration
- debuggable error locations
- clean downstream toolchains after transformation

### Smaller product surface

Palamedes is not trying to preserve every historical shape forever. It prefers:

- one runtime path
- fewer edge-case APIs
- fewer "just in case" compatibility branches

That makes the system stricter, but also more legible.

## What Still Feels Familiar

Palamedes is not a total reset with zero continuity. If you are coming from Lingui, a lot will still look familiar:

- macro-oriented authoring
- `t`, `msg`, and `defineMessage`
- `plural`, `select`, and `selectOrdinal`
- `<Trans>`, `<Plural>`, `<Select>`, and `<SelectOrdinal>`
- extracted catalogs instead of ad hoc inline translation calls

That is exactly why migration is practical: a lot of the day-to-day authoring model stays recognizable while the underlying stack gets cleaner.

## When Lingui Still Makes Sense

Lingui is still a strong choice, especially if:

- you are already deeply invested in Lingui
- you want maximum compatibility with existing Lingui documentation
- you intentionally want to stay inside the established Lingui ecosystem

Palamedes is not an argument that Lingui is bad. It is an argument that the same core ideas can now be pushed into a clearer, more native, more opinionated architecture.

## Recommendation

- If you want to minimally disturb a large existing Lingui setup, staying on Lingui can be reasonable.
- If you are starting fresh or already doing architectural cleanup, Palamedes is the better default.

Continue here:

- [Migration from Lingui](./migrate-from-lingui.md)
