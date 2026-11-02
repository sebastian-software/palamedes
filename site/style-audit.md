# Website style ownership

The OSS site uses Ardo 6.2.0 directly. The cleanup removes the second site shell
and its imported global CSS rather than adding more overrides to reconcile them.

| Surface                            | Owner           | Local responsibility                                        |
| ---------------------------------- | --------------- | ----------------------------------------------------------- |
| Header and logo title              | Ardo            | Logo asset and four destination links                       |
| Search and mobile menu             | Ardo            | No local overrides                                          |
| Footer                             | Ardo            | Links, license, copyright, and required artwork attribution |
| Sidebar                            | Ardo            | Curated content groups and generated API navigation         |
| Article, code, focus, page outline | Ardo            | Source content and heading levels                           |
| Theme                              | Ardo            | Three hue options                                           |
| Marketing sections and specimens   | Site            | `app/components/marketing/primitives.tsx` and `app/app.css` |
| Standalone fragment demo           | Demo            | Its small independent base stylesheet                       |
| Optional shared site UI            | Other consumers | Preserved package API; no OSS-site dependency               |

## Removed

- The Tools menu and family directory, replaced by Ferramenta links.
- The injected `@palamedes/site-ui` dependency, provider, router adapter, full
  palette, body/code resets, shared header/footer, animation rules, and CSS
  required only by unused shared components.
- The palette, font, corner, and shadow overrides, including the temporary
  code-background token.
- Grouped primary navigation and its mobile-dialog CSS.
- Custom wordmark composition and duplicate header actions.
- The progressive-outline generator, manifest, heading planner, and specialized
  styles. Ardo's responsive native outline works from the same content metadata.
- Scroll reveals, ornamental meanders, animated flow connectors, and the matrix scanline.

Product copy, evidence, interactive specimens, public URLs, analytics, and asset
provenance stay in their existing sources. The standalone fragment demo retains
its own small base because it renders outside Ardo's document context.

## Upstream fixes adopted

Ardo 6.2.0 includes the shared page frame, adaptive desktop layout, and code
gutter correction from [Ardo #459](https://github.com/sebastian-software/ardo/pull/459),
[Ardo #460](https://github.com/sebastian-software/ardo/pull/460), and
[Ardo #462](https://github.com/sebastian-software/ardo/pull/462):

- Marketing and documentation share the outer frame, with a default maximum
  of 90rem including gutters. Route-level `fullWidth` remains available for exceptions.
- Documentation shows its right-hand outline from an 80rem frame width.
  Reading typography adapts to the frame without changing the root font size.
- Highlighted code lines compensate for the preformatted block's padding once.

Marketing sections now reference Ardo's page-width, gutter, and section-spacing
tokens instead of maintaining an independent 69rem measure and viewport spacing.
These changes require no local document or chrome overrides.

Ardo 6.1.2 includes the general corrections from
[Ardo #447](https://github.com/sebastian-software/ardo/pull/447) and
[Ardo #448](https://github.com/sebastian-software/ardo/pull/448):

- Related-route matching exposes the current page to assistive technology.
- Mobile navigation stacks vertically and menu icons retain 44px targets.
- Breadcrumbs and documentation cards wrap in narrow layouts.
- Logo and title produce one accessible home-link name.
- The light code surface preserves GitHub Light comment contrast.

Ardo 6.1.2 also restores keyboard focus after reloading a failed search. This
uses the upstream search behavior without a local patch.

The site now uses `ArdoNavLink` with the native `activeMatch` option and a logo
asset path. The local link adapter, chrome CSS, card compatibility class, and
white code-background token are removed. Marketing composition and three hue
choices remain local. Navigation analytics retain their existing destination
IDs through the site's collector, without an application link adapter.

## Verification

Normal-size text fits at 320, 390, 720, 1024, and 1440px in the additional
homepage and guide checks. Marketing pages allow long text to wrap at enlarged
text sizes. Get started and Proof fit at 390px with 200% root text size. The
guide now fits at 320px with 200% text after adopting Ardo's breadcrumb fix.
The homepage retains the previously observed overflow at that extreme size.

The build checks internal links and heading anchors. `verify:site-outlines`
checks native outlines in the shipped HTML, and `verify:site-routes` exercises
keyboard disclosure and anchor navigation with and without JavaScript. The
accessibility pass covers responsive layouts and the live fragment demo.
See [ADR-011](../adr/011-editorial-visual-brand-system.md) and
[ADR-027](../adr/027-shared-cross-repository-site-ui.md) for the durable boundary.
