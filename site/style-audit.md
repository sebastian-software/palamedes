# Website style ownership

The OSS site uses Ardo 6.3.0 directly. The Palamedes identity is a small local
layer over its public theme and content-container APIs.

| Surface                            | Owner              | Local responsibility                                                 |
| ---------------------------------- | ------------------ | -------------------------------------------------------------------- |
| Header and logo title              | Ardo               | Logo asset and destination links                                     |
| Search and mobile menu             | Ardo               | No local overrides                                                   |
| Footer                             | Ardo               | Links, license, copyright, and artwork attribution                   |
| Sidebar                            | Ardo               | Curated groups and generated API navigation                          |
| Article, code, focus, page outline | Ardo               | Source content and heading levels                                    |
| Brand palette                      | Site, through Ardo | Typed light-theme colors in `app/ardo-theme.ts`                      |
| Marketing width and gutters        | Ardo               | Public `ArdoContentContainer` composition                            |
| Marketing sections and specimens   | Site               | Cinzel headings, fine rules, bronze actions, and local section tones |
| Standalone fragment demo           | Demo               | Its independent base stylesheet                                      |
| Optional shared site UI            | Other consumers    | Preserved package API; no OSS-site dependency                        |

## Restored identity

Warm paper, parchment, mist, navy ink, and accessible bronze reconnect the site
to its Greek emblem and inscription-style headings. The shared shell and local
specimens use the same semantic Ardo tokens. The exact palette lives once in
`app/ardo-theme.ts`; Tailwind aliases do not define a second color system.

Marketing actions regain square corners and a bronze fill. Ardo retains its
own document typography, corners, shadows, code styling, focus states, and
navigation behavior. The existing emblem, font, film, and licensed artwork are
reused. No additional image assets or animation system are needed.

## Simplification retained

- Ferramenta is a simple header and footer link. The Tools menu and family
  directory remain removed.
- The OSS site does not import `@palamedes/site-ui`, its provider, global resets,
  shared header/footer, or second token system. Other consumers retain that API.
- There are no selectors for generated Ardo classes, chrome layout overrides,
  local code-gutter patches, or custom responsive-outline generators.
- Scroll reveals, ornamental meanders, animated flow connectors, and the matrix
  scanline remain removed.

Product copy, evidence, interactive specimens, public URLs, analytics, and asset
provenance stay in their existing sources.

## Upstream layout

[Ardo 6.3.0](https://github.com/sebastian-software/ardo/releases/tag/ardo-v6.3.0)
adopts a full-width shell with bounded inner content. Header, footer, marketing,
and documentation surfaces can extend to the viewport edge without an unrelated
outer background. Local marketing sections use the new public
`ArdoContentContainer`; the duplicate width formula and gutter variables are removed.

The default page-content measure is 87rem plus responsive gutters. Guides retain
Ardo's narrower reading measure; generated API references use the wider page
measure. Documentation shows its right-hand outline from 80rem. Ardo also owns
adaptive typography and the highlighted-code indentation correction adopted
with 6.2.0. None of these require a local document or chrome patch.

Ardo's native navigation supplies active-route semantics, 44px menu controls,
mobile wrapping, accessible logo naming, and search focus restoration. Its
white code ground retains the contrast expected by GitHub Light syntax colors.

## Verification

The site build checks internal links and heading anchors. `verify:site-outlines`
checks native outlines in the shipped HTML; `verify:site-routes` exercises
keyboard disclosure and anchor navigation with and without JavaScript. The
accessibility pass covers responsive layouts and the live fragment demo.

See [ADR-011](../adr/011-editorial-visual-brand-system.md) and
[ADR-027](../adr/027-shared-cross-repository-site-ui.md) for the durable boundary.
