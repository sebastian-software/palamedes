/*
 * Who funds the major JavaScript i18n libraries.
 *
 * This section exists because the answer is genuinely surprising and entirely
 * checkable: almost every actively-funded library in this field is either
 * sponsored by translation vendors or built by one. That is not an accusation
 * — sponsorship is how several of these maintainers get paid at all, and it is
 * disclosed on public pages. But it points incentives somewhere, and a reader
 * choosing a dependency deserves to know where.
 *
 * Non-negotiable: this section ships alongside our own disclosure. Palamedes+
 * is planned as an optional commercial layer, with ADR-018 defining how its
 * commands integrate with the shared CLI. Making this argument without saying
 * so would be exactly the kind of thing the rest of these pages refuse to do.
 *
 * Sources are the projects' own public funding pages, dated per row.
 */

export interface FundingRow {
  project: string
  /** Who actually pays for the work. */
  funder: string
  /** What that funder sells, if anything. */
  sells: string
  checked: string
}

export const FUNDING: FundingRow[] = [
  {
    project: "i18next",
    funder: "locize — built and run by the i18next maintainers themselves",
    sells: "A hosted translation platform. Its revenue explicitly funds i18next development.",
    checked: "July 2026",
  },
  {
    project: "next-intl",
    funder: "GitHub Sponsors — 8 sponsors, including Crowdin, i18nexus and General Translation",
    sells:
      "Two translation platforms and a competing i18n library, funding a single independent maintainer.",
    checked: "July 2026",
  },
  {
    project: "Lingui",
    funder: "Open Collective — Translation.io ($2,400), Crowdin ($1,300), Sector Labs ($1,000)",
    sells: "Every named organisational sponsor is a translation vendor or localization agency.",
    checked: "July 2026",
  },
  {
    project: "Paraglide (inlang)",
    funder: "Opral GmbH",
    sells: "Its own ecosystem and editor products; no visible monetization of the library itself.",
    checked: "July 2026",
  },
  {
    project: "Tolgee",
    funder: "Tolgee s.r.o., seed funding and public grants",
    sells: "Its own open-core translation platform. The SDK is the way in.",
    checked: "July 2026",
  },
  {
    project: "General Translation",
    funder: "Venture capital (~$2.4–2.7M seed)",
    sells: "Its own AI translation platform and CDN — and it sponsors next-intl.",
    checked: "July 2026",
  },
  {
    project: "React Intl",
    funder: "No disclosed funding; effectively one primary maintainer",
    sells: "Nothing. Which is also why throughput on non-core work is thin.",
    checked: "July 2026",
  },
  {
    project: "Palamedes",
    funder: "Sebastian Software GmbH — the company that builds it",
    sells:
      "Nothing today. Palamedes+ is planned as an optional managed layer for translation automation and collaboration; the local catalogs remain repository-owned.",
    checked: "July 2026",
  },
]
