# Competing Visual Design Drafts

Three deliberately divergent visual directions for the Palamedes site, all
built on the same information architecture and copy from
[`docs/site/structure/`](../README.md). These are **design mocks, not
implementations**: single self-contained HTML files, system fonts only, no
build step — open them directly in a browser. Each file contains four views
(Home, Frameworks, Proof, Get started) switched by the top navigation.

They exist to make the direction decision in
[#290](https://github.com/sebastian-software/palamedes/issues/290) concrete:
same content, three different personalities.

| Draft | File                                                   | Direction        | Personality                                                                       |
| ----- | ------------------------------------------------------ | ---------------- | --------------------------------------------------------------------------------- |
| A     | [`design-a-spec-grid.html`](design-a-spec-grid.html)   | Swiss Spec Grid  | Light, strict, standards-document: hairline grid, one blue accent, spec tables    |
| B     | [`design-b-terminal.html`](design-b-terminal.html)     | Terminal / Ops   | Dark, monospace, developer-native: terminal hero, status LEDs, CI-log proof view  |
| C     | [`design-c-editorial.html`](design-c-editorial.html)   | Editorial Calm   | Warm paper, serif long-form essay: pull quotes, author's note, composed pacing    |

Rough mapping to the #290 exploration: A ≈ variant 03 (Swiss specification
grid), B ≈ variants 02/07 (ops cockpit / CLI-and-repo-first), C ≈ variants
01/05 (editorial stack / founder-led editorial).

## Shared ground rules

All three drafts follow the messaging rules from the structure README:

- copy comes verbatim from the page specs (review-ready draft status, see #290)
- speed claims stay scoped to the checked machine-local benchmark
- matrix cells carry explicit demo links + hosting status (subdomain/TLD =
  provisioning, no demo link — see #306); all cells marked CI-verified
- no external resources: everything renders offline

## How to evaluate

1. Open all three side by side and judge the first 10 seconds of the Home view.
2. Switch to Frameworks — which matrix treatment makes the 5×4 proof most
   credible?
3. Check Get started — which one makes the 6-step flow feel shortest?
4. Pick one primary + one backup, then fold the decision back into #290 and
   the implementation issue #321.
