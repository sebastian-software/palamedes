# ADR-028: README Theme Composition

**Status:** Accepted

**Last updated:** 2026-10-16

Native mdtheme composes the project README from its source and pinned shared themes.

## Decision

The project README is composed by native mdtheme from `README.md.src`. The
outer frame is Sebastian Software; Ferramenta is the inner frame. Footers close
in reverse order. The project content remains the main focus; shared branding
is compact and maintained upstream. The Ferramenta footer excludes this project
and includes sibling descriptions and the family icon.

Pin the CLI with mise and both Git theme revisions in mdtheme.yaml. CI checks
the generated output. Source and output are committed together. Standards
repositories explicitly delegate README ownership to mdtheme, so standards
cannot append a second company footer. Published subpackage READMEs keep their
compact registry format and existing generator.

## Context

The README needs consistent family branding without duplicate footers or
hand-maintained generated output. Root and npm package READMEs have different
rendering constraints, so their generators remain separate.

## Theme badge placement

The project pins mdtheme in `mise.toml` and uses one `mdtheme:badges:start` /
`mdtheme:badges:end` comment pair in `README.md.src`. The Sebastian Software
theme prepends its badge before the authored project badges.
Ferramenta's header and footer stay unchanged. Update the CLI and theme pins together when their contracts change. Keep badge markup outside raw HTML blocks.

## Consequences

Contributors edit the source, then regenerate. No JavaScript configuration or
Node installation is needed for the root README. Shared theme updates are
reviewable Git diffs. Rendering requires network access to the Git sources.

See [the contributor guide](https://github.com/sebastian-software/palamedes/blob/main/docs/readme-theme.md) for commands.
