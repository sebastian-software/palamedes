# Website style ownership

The OSS site uses Ardo 6 directly. The cleanup removes the second site shell
and its imported global CSS rather than adding more overrides to reconcile them.

| Surface                            | Owner           | Local responsibility                                        |
| ---------------------------------- | --------------- | ----------------------------------------------------------- |
| Header and logo title              | Ardo            | Logo asset and four destination links                       |
| Search and mobile menu             | Ardo            | Two temporary 44px menu-target rules for Ardo 6.0           |
| Footer                             | Ardo            | Links, license, copyright, and required artwork attribution |
| Sidebar                            | Ardo            | Curated content groups and generated API navigation         |
| Article, code, focus, page outline | Ardo            | Source content and heading levels                           |
| Theme                              | Ardo            | Three hue options and one temporary code-background token   |
| Marketing sections and specimens   | Site            | `app/components/marketing/primitives.tsx` and `app/app.css` |
| Standalone fragment demo           | Demo            | Its small independent base stylesheet                       |
| Optional shared site UI            | Other consumers | Preserved package API; no OSS-site dependency               |

## Removed

- The Tools menu and family directory, replaced by Ferramenta links.
- The injected `@palamedes/site-ui` dependency, provider, router adapter, full
  palette, body/code resets, shared header/footer, animation rules, and CSS
  required only by unused shared components.
- The palette, font, corner, and shadow overrides. One code-background token
  remains temporarily because GitHub Light comments lose contrast on a tint.
- Grouped primary navigation and its mobile-dialog CSS.
- Custom wordmark composition and duplicate header actions.
- The progressive-outline generator, manifest, heading planner, and specialized
  styles. Ardo's responsive native outline works from the same content metadata.
- Scroll reveals, ornamental meanders, animated flow connectors, and the matrix scanline.

Product copy, evidence, interactive specimens, public URLs, analytics, and asset
provenance stay in their existing sources. The standalone fragment demo retains
its own small base because it renders outside Ardo's document context.

## Compatibility exceptions

Ardo 6.0's `ArdoNavLink.activeMatch` highlights related routes without setting
`aria-current`. The small local link adapter preserves that semantic state for
the Guides hub. Two menu-size rules keep existing 44px controls until an Ardo
release contains the upstream fix. The decorative logo element also avoids
Ardo 6.0 announcing the title twice.
The mobile `.ardo-nav` also needs a vertical layout inside the public
`.ardo-mobile-panel` container, and code surfaces use white so GitHub Light
comments reach 4.5:1 instead of 4.09:1. None of these exceptions targets
generated classes. Documentation cards also need a local minimum-width and
heading-wrap correction until Ardo ships the upstream card reflow fix.

The [upstream Ardo PR](https://github.com/sebastian-software/ardo/pull/447) covers
current-link semantics, menu target size, breadcrumb reflow, and the accessible
home-link name, mobile navigation flow, and the highlighter background.
The code-surface correction follows the shipped syntax theme; it does not add
Palamedes-specific colors or typography.
The [card reflow fix](https://github.com/sebastian-software/ardo/pull/448)
has its own follow-up PR.
After adopting a release with those fixes, replace the local navigation adapter
with `ArdoNavLink` and remove the menu-size, mobile-flow, code-background,
and documentation-card compatibility rules.

## Verification

Normal-size text fits at 320, 390, 720, 1024, and 1440px in the additional
homepage and guide checks. Marketing pages allow long text to wrap at enlarged text sizes. Get started
and Proof fit at 390px with 200% root text size. The additional homepage and
guide checks still show overflow at 320px with 200% text, as on the previous
site. The guide includes the pinned Ardo breadcrumb issue addressed upstream.

The build checks internal links and heading anchors. `verify:site-outlines`
checks native outlines in the shipped HTML, and `verify:site-routes` exercises
keyboard disclosure and anchor navigation with and without JavaScript. The
accessibility pass covers responsive layouts and the live fragment demo.
See [ADR-011](../adr/011-editorial-visual-brand-system.md) and
[ADR-027](../adr/027-shared-cross-repository-site-ui.md) for the durable boundary.
