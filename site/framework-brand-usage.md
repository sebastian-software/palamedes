# Framework Brand Usage Ledger

This record covers the framework names and logo assets considered for the
Palamedes homepage integration band and framework demo index. It is implementation evidence, not legal
advice. Recheck each upstream policy and involve qualified counsel before a
new asset is added or this public marketing use changes.

Reviewed: 2026-08-13

Compact identity assets updated: 2026-10-23.

## Decision

The homepage, framework matrix, and setup overview use unmodified compact
marks with visible names through one shared identity component. The Product Owner explicitly accepted the remaining
trademark-risk decision on 2026-08-13 while Palamedes seeks confirmation from
the relevant maintainers. The band identifies integrations only; it does not
state or imply endorsement, partnership, sponsorship, adoption, or
certification.

This record is implementation evidence, not legal advice. It does not replace
review by qualified counsel.

## Per-framework review

| Framework      | Asset source                                                                                                          | Current treatment                       | Conditions / follow-up                                                                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js        | [Vercel Next.js asset archive](https://k2mkucxia43oc7fa.public.blob.vercel-storage.com/front/press/nextjs-assets.zip) | Official light-background icon + name   | Vercel's published policy still calls for permission for this product-marketing context. A confirmation request is outstanding; its requested attribution is included in `THIRD_PARTY_NOTICES.md`.                                                              |
| TanStack Start | [TanStack light-surface favicon](https://tanstack.com/favicon-light.svg)                                              | Official icon + name                    | Preserve proportions, original colors, and clear space under the [published usage guide](https://tanstack.com/ds/logos#usage).                                                                                                                                  |
| Solid          | [Solid site logo](https://start.solidjs.com/logo.svg)                                                                 | Official emblem + name                  | The project currently publishes an emblem rather than a separate Solid wordmark; the canonical name is displayed beside it.                                                                                                                                     |
| Waku           | [Waku starter icon](https://raw.githubusercontent.com/wakujs/waku/main/templates/01_basic/public/images/favicon.png)  | Official project icon + name            | Use the original PNG from Waku's first-party starter without recoloring or cropping.                                                                                                                                                                            |
| React Router   | [React Router compact logo](https://reactrouter.com/_brand/react-router-brand-assets/logo/Light.svg)                  | Official emblem + name                  | Use the light-surface variant and do not imply an official connection with or endorsement by Shopify.                                                                                                                                                           |
| Remix          | [Remix light-mode logo](https://remix.run/_brand/remix-logo-light-mode.svg)                                           | Official emblem + name                  | Use the background-appropriate variant and do not imply an official connection with or endorsement by Shopify.                                                                                                                                                  |
| Vite           | [Vite site icon](https://vite.dev/logo-without-border.svg)                                                            | Official emblem + name                  | The asset is the same compact icon referenced by Vite's official site.                                                                                                                                                                                          |
| Turbopack      | [Vercel Turbo asset archive](https://k2mkucxia43oc7fa.public.blob.vercel-storage.com/front/press/turbo-assets.zip)    | Official light-background symbol + name | Use `TURBO/turbopack/icon/light-background/turbopack-icon-light-background.svg` unchanged. Vercel's [brand guidelines](https://vercel.com/geist/brands#turbopack-symbol) govern the symbol; the same product-marketing permission follow-up as Next.js applies. |
| Hono           | [Hono project logo](https://raw.githubusercontent.com/honojs/hono/main/docs/images/hono-logo.svg)                     | Official emblem + name                  | The project publishes an emblem at this source; the canonical name is displayed beside it.                                                                                                                                                                      |
| Express        | [Express site favicon](https://expressjs.com/favicon.svg)                                                             | Official icon + name                    | Express directs users to the OpenJS trademark policy. The mark is used only to identify the supported backend integration.                                                                                                                                      |
| React          | [React logo, react.dev repository](https://github.com/reactjs/react.dev/blob/main/public/images/brand/logo_light.svg) | Official emblem + name                  | Retrieved 2026-10-19. The emblem is shown unmodified with the name beside it; do not imply an endorsement by Meta.                                                                                                                                              |
| Rust           | [Rust logo](https://www.rust-lang.org/logos/rust-logo-blk.svg)                                                        | Official emblem + name                  | Retrieved 2026-10-19. Used unmodified to refer to Rust under the Rust Foundation's trademark policy; it identifies the Rust integration, not an endorsement.                                                                                                    |

## Framework demo index additions

Retrieved 2026-10-22. These unmodified assets identify the corresponding live
integration demos on `/frameworks`. Their display does not imply endorsement.

| Framework | Asset source                                                                        | Treatment and conditions                                                                                                                                                                  |
| --------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vue       | [Vue artwork](https://github.com/vuejs/art/blob/master/logo.svg)                    | Official emblem + name. Vue's artwork license expressly permits illustrating a commercial product's Vue integration; credit Evan You and retain the upstream license link in the notices. |
| Nuxt      | [Nuxt design kit](https://nuxt.com/design-kit)                                      | Official green icon + name. The design kit permits the triangular mountains on their own as an icon; preserve its color and proportions.                                                  |
| Svelte    | [Svelte branding](https://github.com/sveltejs/branding/blob/master/svelte-logo.svg) | Official emblem + name. Accurate integration identification under the project's branding guidelines; no endorsement claim.                                                                |
| SvelteKit | [Svelte branding](https://github.com/sveltejs/branding/blob/master/svelte-logo.svg) | Shared official Svelte emblem + visible “SvelteKit” name. The two integrations use the same asset and dimensions; their visible names distinguish them.                                   |

The homepage, matrix, and setup overview share a 32 px icon slot and 15 px
visible names. Per-asset dimensions balance the visible artwork while retaining
its proportions and internal clear space. Right alignment and quarter-pixel
display offsets account for transparent space inside the original canvases,
keeping approximately 16 px between each painted right edge and its name.
The source artwork is neither cropped nor modified. The compact assets were retrieved
2026-10-23; SHA-256 receipts and the earlier wordmark sources are recorded in
`THIRD_PARTY_NOTICES.md`.

## Product film

The product film in `video/` shows the unmodified React, Solid, Next.js, TanStack,
Remix, and Vite files in one framework-integration scene, grouped as UI
libraries, frameworks, and build tool. They identify first-party integrations.
The film uses an unmodified copy of the React mark (retrieved 2026-10-19), with
Meta's trademark noted in `THIRD_PARTY_NOTICES.md`. The film names no support
levels, so a change in an adapter's status does not require a new render; the
site states the levels.
Waku appears as its name in text, because its published SVG is drawn for dark
surfaces and must not be recoloured, and its site icon is an emoji image rather
than a mark.

On 2026-10-17 the Product Owner decided to publish the long cut
(`PalamedesFilm`) on the homepage, on the same trademark-risk position as the
integration band above. The Next.js confirmation request remains outstanding.

## Preconditions for a future logo change

1. Reconfirm the concrete marketing use with any maintainer who asks for it;
   Next.js is the currently identified request.
2. Preserve original artwork, proportions, and required clear space; never
   recolor or redraw a mark unless its policy explicitly allows it.
3. Keep `THIRD_PARTY_NOTICES.md` and this record aligned with the source URL,
   retrieval date, and SHA-256 for every shipped asset.
