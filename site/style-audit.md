# Ardo 6 Style Audit

Reviewed November 2, 2026, against Ardo 6.0.0 and main revision `a53f75f0`.
The scope covers `app/app.css`, `app/ardo-theme.ts`, the root composition, and
the imported `@palamedes/site-ui` styles.

Most custom CSS belongs to the marketing pages and shared components. It is
not an override of Ardo's documentation components. The theme and editorial
composition preserve [ADR-011](../adr/011-editorial-visual-brand-system.md).
They are design choices, not requirements for running Ardo.

## Remaining customization

| Owner                         | Customization                                                                                                        | Assessment                                                                                                                                                                                                                   |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/ardo-theme.ts`           | Paper, navy, and bronze colors; body and mono fonts; square corners; flat surfaces; white code background            | Keep the typed public theme API. Ardo's defaults have a different palette and rounded, shaded surfaces. The white code ground preserves the measured contrast of GitHub Light syntax colors.                                 |
| `app/app.css` imports         | Explicit `theme`, `base`, `ardo`, `components`, and `utilities` layer order                                          | Keep. Shared components and Tailwind utilities intentionally follow Ardo. No generated class names are targeted.                                                                                                             |
| Root logo slot                | Logo image and the shared `Wordmark`                                                                                 | Keep for the brand. The public slot also gives the mobile panel the same wordmark without a selector into Ardo's markup.                                                                                                     |
| Primary navigation            | Two groups, desktop separator, mobile labels, active links, mobile row spacing                                       | Product-specific navigation. Ardo owns the header and dialog; these rules style the supplied children. Native `ArdoNavLink` styling is an optional simplification if the editorial navigation treatment is no longer wanted. |
| Mobile menu buttons           | 44 px minimum width and height on the open and close controls                                                        | Keep. The Ardo defaults are smaller. The selectors use accessible labels because this header does not expose individual button style props.                                                                                  |
| `.pmds-page`                  | Full-width marketing pages, without the shared package's side borders                                                | Keep for the existing band layout. This overrides the shared `Page` component's 1320 px frame, not Ardo. It needs no `!important` or dependency on `#main-content`.                                                          |
| Progressive outlines          | Index micro-labels, a shaded outline, list indentation, and disclosure spacing                                       | Custom content generated for long guides. These styles do not restyle Ardo's sidebar or table of contents. Replacing this reading pattern with Ardo's native outline would be a separate simplification.                     |
| Marketing composition         | Band backgrounds, section and hero type, spacing, listing specimens, journey and flow illustrations, and arrow links | Own components, not documentation overrides. Retain while the site keeps its editorial marketing layout. Reduced motion leaves a static flow.                                                                                |
| Footer metadata               | Wrapping under text zoom                                                                                             | Keep. Prevents build metadata from widening the page. The shared footer is outside `ArdoRoot`.                                                                                                                               |
| `packages/site-ui/styles.css` | Tokens, reset, inline code, shared components, navigation, family surfaces, animations, and reduced-motion rules     | Shared with other consumers under [ADR-027](../adr/027-shared-cross-repository-site-ui.md). Most rules style `.pmds-*` components. The exceptions and remaining cleanup opportunities are below.                             |

The root also supplies its own sidebar groups and shared footer, fixes the
color scheme to light, hides the theme toggle, requests icon-only search, and
uses document scrolling. These are public composition and behavior options,
not CSS overrides. The light-only setting is intentional until a complete
dark palette exists. The shared footer replaces Ardo's default footer.

## Removed in this cleanup

- The Tools flyout and the nine-entry footer family list. Header and footer
  now link directly to Ferramenta using the registry's canonical family URL.
- Footer overrides for an Ardo footer containing `SiteFooter`. That structure
  no longer exists: `ArdoRoot` disables its footer and the shared footer follows
  the root.
- Header border and inner-container overrides, including the separate mobile
  padding rule. Ardo already gets the border color from the theme and owns its
  responsive header layout. The header class still exists in Ardo 6; those
  rules were active, unlike the obsolete footer selectors.
- The descendant selector that restyled Ardo's title span, including its
  tool-switcher exclusion. The logo slot now owns the wordmark.
- Local focus rules for outline links, disclosures, navigation, menu controls,
  buttons, and arrow links. Ardo already supplies a visible global focus ring
  through the theme's brand color.
- Explicit heading-family and line-height theme values that duplicated
  Ardo's inherited heading font and default `1.65` line height.
- The structural page selector and all six local `!important` declarations.
  A direct `.pmds-page` rule retains the required full-width composition.

## Further simplification opportunities

The shared stylesheet still contains a global `code` rule and `pre code`
reset. Because its component layer follows Ardo, those rules affect generated
documentation too: inline-code size, padding, and background come partly from
the shared stylesheet. This is an overlap rather than a requirement of Ardo.
Scoping those rules to marketing components would give documentation back to
Ardo, but it changes the shared package's behavior and should be checked in
both consumers.

The imported shared stylesheet also includes styles for unused components,
including `SiteHeader`, `ToolSwitcher`, and `FamilyLine`. Disabling those
surfaces removes their markup and client behavior from this site, but CSS
does not tree-shake with the component exports. Splitting component styles
into optional imports would reduce that remaining payload. The exported
shared components remain available for other consumers.

The direct marketing-page overrides of shared section typography and spacing
are another ownership overlap. Moving the newer editorial defaults into the
shared package would remove them here, but would also change the other site's
appearance. They remain local until both consumers adopt the same composition.

## Evidence

The baseline was checked on the homepage and a generated guide at 1440 px and
390 px. Removing the footer selectors matched no elements. Removing the page
rule narrowed the desktop marketing page to the shared component's 1320 px
frame, which is why the simpler full-width rule remains. The mobile menu's
close control measured 44 by 44 px with the retained minimum-size rule.

The changed homepage and guide were then checked at 1440, 1024, 720, 390, and
320 px. At normal text size, the marketing page retained the full viewport
width without horizontal overflow. Ferramenta remained reachable in the desktop header, mobile menu,
and footer. Keyboard focus used Ardo's 2 px ring, and Escape returned focus to
the menu trigger. Desktop, mobile, footer, and open-menu screenshots were
inspected.

The same five widths were also checked with a 200% root font size. The logo
slot retains Ardo's title-truncation behavior, so its wordmark does not overlap
search at any tested width. Its mobile home link retains the accessible name
Palamedes.

That additional font-resize check also found existing page overflow on the
homepage at 1024, 720, and 320 px, and on the generated guide at 320 px. Each
case reproduced on the unchanged baseline as well. These content-reflow
limitations remain separate from the header cleanup; the standard viewport
checks and the root-font-resize stress case exercise different conditions.
Examples include the fixed-width label column in `SplitDiagram.tsx`, the copy
and counter controls in narrow marketing panels, and Ardo's generated guide
breadcrumb. Intentionally scrollable code blocks and clipped decorative
artwork also extend beyond their containers; those are not evidence of a
page-reflow defect on their own.
