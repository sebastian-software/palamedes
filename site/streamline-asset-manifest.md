# Streamline Asset Manifest

Selection and provenance ledger for Streamline assets intended for
palamedes.dev. This file records project use; it does not redistribute assets
or grant rights under the repository's MIT license.

## License context

- Plan confirmed on 2026-08-12: **Full Access plan / 1 user**
- Entitlements shown by the account: **All Pro Icons** and **All Pro
  Illustrations**
- Selected icon set: **Streamline Sharp Duo** only
- Selected illustration set: **Streamline UX Duotone** only
- Initial unique icon count: **8**
- Initial illustration count: **3**
- Standard project allowance to monitor: **100 unique icons**
- Standard project allowance to monitor: **50 illustrations**
- Licensed source access: account owner only; contributors receive only the
  prepared project selection
- Private evidence: retain the account screenshot, invoice, and applicable
  license text outside the public repository

`THIRD_PARTY_NOTICES.md` excludes these assets from the Palamedes MIT grant,
and the public site footer carries the required Streamline OSS attribution.

## Selected icons

All entries were exported from the licensed account, optimized into the
Palamedes navy/bronze palette, and integrated on 2026-08-17. The target path is
`site/public/icons/streamline/sharp-duo/<filename>.svg`.

| Role                         | Asset                             | Source                                                                                             | Target filename                         | Export date | SHA-256                                                            |
| ---------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------- | ------------------------------------------------------------------ |
| Clear / source inspection    | Code Analysis                     | [Streamline](https://www.streamlinehq.com/icons/download/code-analysis--25116)                     | `code-analysis.svg`                     | 2026-08-17  | `f2d0d19f3d36c5b4d09e54b42446c9414d0fd4be470c4d7f181ae908fbaf587c` |
| Complete / pipeline          | Deployment Workflow Collaboration | [Streamline](https://www.streamlinehq.com/icons/download/deployment-workflow-collaboration--25115) | `deployment-workflow-collaboration.svg` | 2026-08-17  | `131e0114fa04fe2aa145227fca364301499bb8cf8ae9bbbe5582d01bc58d7e16` |
| Fast / benchmark             | Browser Flash                     | [Streamline](https://www.streamlinehq.com/icons/download/browser-flash--25121)                     | `browser-flash.svg`                     | 2026-08-17  | `17755430c2d2737aa044c941af298eaed1092e588e7ea21db28109f1cdd23e98` |
| Architecture                 | Web Hierarchy                     | [Streamline](https://www.streamlinehq.com/icons/download/web-hierarchy--25115)                     | `web-hierarchy.svg`                     | 2026-08-17  | `908ad7f7f3f7c9c63cc99521af65ba7768edb0ff1579825f58af72602bf546a2` |
| First-party adapter breadth  | App Widgets Plugin Extension      | [Streamline](https://www.streamlinehq.com/icons/download/app-widgets-plugin-extension--25122)      | `app-widgets-plugin-extension.svg`      | 2026-08-17  | `3562983d757759eccc4c59cd9e80722ef8b53a656b2dd97d6780eec5011bc60e` |
| Locale architecture          | Globe App Network                 | [Streamline](https://www.streamlinehq.com/icons/download/globe-app-network--25115)                 | `globe-app-network.svg`                 | 2026-08-17  | `e47ebb5e2cf164e023cd63da6b4874a55ec091a45d5c173b4410f7117a895db0` |
| Documentation / maintenance  | Programming Book                  | [Streamline](https://www.streamlinehq.com/icons/download/programming-book--25116)                  | `programming-book.svg`                  | 2026-08-17  | `b541b2243355232d4d9ef4a31ba7e4865e6515897257d263d169d1d4e44df9ff` |
| Proof / verified application | Browser Check                     | [Streamline](https://www.streamlinehq.com/icons/download/browser-check--25121)                     | `browser-check.svg`                     | 2026-08-17  | `29d6cc990989702594576d3e7b2c66e1bc3b7b1703827b999ec94b314a7d434b` |

## Selected illustrations

These entries are selected as implementation experiments and pending licensed
export. The target path is
`site/public/illustrations/streamline/ux-duotone/<filename>.svg`.

| Role                                     | Asset                  | Source                                                                                          | Target filename              | Export date | SHA-256 |
| ---------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------- | ----------- | ------- |
| Brand story / maintainer trust / closing | Quill Software Writing | [Streamline](https://www.streamlinehq.com/illustrations/download/quill-software-writing--10413) | `quill-software-writing.svg` | pending     | pending |
| Complete local workflow introduction     | Flowchart Paper        | [Streamline](https://www.streamlinehq.com/illustrations/download/flowchart-paper--10295)        | `flowchart-paper.svg`        | pending     | pending |
| Proof / verification introduction        | App Testing            | [Streamline](https://www.streamlinehq.com/illustrations/download/app-testing--10295)            | `app-testing.svg`            | pending     | pending |

## Change rules

- Add or replace an icon only with another **Sharp Duo** asset.
- Add or replace an illustration only with another **UX Duotone** asset.
- Record every unique committed icon here, even when it is used only once.
- Record every committed illustration here. Repeated placements do not create
  additional manifest entries.
- Do not commit unused exports, complete sets, source archives, screenshots of
  licensed vectors, or account/license credentials.
- Complete the export date and hash after optimization so the manifest
  identifies the exact bytes shipped by the site.
- If the project approaches 100 unique Streamline icons, stop and review the
  license allowance before adding more.
- If the project approaches 50 Streamline illustrations, stop and review the
  separate illustration allowance before adding more.
