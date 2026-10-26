# ADR-028: README Theme Composition

**Status:** Accepted

**Last updated:** 2026-10-26

Native mdtheme composes the project README from its source and a pinned company theme.

## Decision

The project README is composed by native mdtheme from `README.md.src` with the
Sebastian Software theme. The company badge and consulting footer remain;
Ferramenta family introductions and sibling links are omitted from the root
README. Its job is to summarize capabilities, identify integration boundaries,
and link every usable public npm package with registry badges. Setup, API
details, benchmarks, and framework demos are delegated to palamedes.dev.

Pin the CLI with mise and the Git theme revision in mdtheme.yaml. CI checks
the generated output. Source and output are committed together. Standards
repositories explicitly delegate README ownership to mdtheme, so standards
cannot append a second company footer. Published subpackage READMEs keep their
compact registry format and existing generator.

## Context

The README needs consistent company branding without duplicate footers or
hand-maintained generated output. Ferramenta sibling links distract readers
evaluating an i18n tool; the website owns the detailed adoption path. Root and
npm package READMEs have different rendering constraints, so their generators
remain separate.

## Theme badge placement

The project pins mdtheme in `mise.toml` and uses one `mdtheme:badges:start` /
`mdtheme:badges:end` comment pair in `README.md.src`. The Sebastian Software
theme prepends its badge before the authored project badges.
Update the CLI and theme pin together when their contracts change. Keep badge
markup outside raw HTML blocks.

## Consequences

Contributors edit the source, then regenerate. No JavaScript configuration or
Node installation is needed for the root README. Shared theme updates are
reviewable Git diffs. Rendering requires network access to the Git sources.

See [the contributor guide](https://github.com/sebastian-software/palamedes/blob/main/docs/readme-theme.md) for commands.
