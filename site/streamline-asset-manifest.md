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

Before committing the first SVG, add `THIRD_PARTY_NOTICES.md`, exclude the
assets from the Palamedes MIT grant, and add the required Streamline attribution
to a suitable public credits/about surface.

## Selected icons

All entries are selected for the first implementation and pending licensed
export. The target path is
`site/public/icons/streamline/sharp-duo/<filename>.svg`.

| Role                         | Asset                             | Source                                                                                             | Target filename                         | Export date | SHA-256 |
| ---------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------- | ------- |
| Clear / source inspection    | Code Analysis                     | [Streamline](https://www.streamlinehq.com/icons/download/code-analysis--25116)                     | `code-analysis.svg`                     | pending     | pending |
| Complete / pipeline          | Deployment Workflow Collaboration | [Streamline](https://www.streamlinehq.com/icons/download/deployment-workflow-collaboration--25115) | `deployment-workflow-collaboration.svg` | pending     | pending |
| Fast / benchmark             | Browser Flash                     | [Streamline](https://www.streamlinehq.com/icons/download/browser-flash--25121)                     | `browser-flash.svg`                     | pending     | pending |
| Architecture                 | Web Hierarchy                     | [Streamline](https://www.streamlinehq.com/icons/download/web-hierarchy--25115)                     | `web-hierarchy.svg`                     | pending     | pending |
| First-party adapter breadth  | App Widgets Plugin Extension      | [Streamline](https://www.streamlinehq.com/icons/download/app-widgets-plugin-extension--25122)      | `app-widgets-plugin-extension.svg`      | pending     | pending |
| Locale architecture          | Globe App Network                 | [Streamline](https://www.streamlinehq.com/icons/download/globe-app-network--25115)                 | `globe-app-network.svg`                 | pending     | pending |
| Documentation / maintenance  | Programming Book                  | [Streamline](https://www.streamlinehq.com/icons/download/programming-book--25116)                  | `programming-book.svg`                  | pending     | pending |
| Proof / verified application | Browser Check                     | [Streamline](https://www.streamlinehq.com/icons/download/browser-check--25121)                     | `browser-check.svg`                     | pending     | pending |

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
