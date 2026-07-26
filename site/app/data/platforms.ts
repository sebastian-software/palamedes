/*
 * Translation platforms (TMS). These are not competitors and the /compare hub
 * says so plainly — they solve hosted workflow, vendor management and
 * delivery, none of which Palamedes does. The useful thing a comparison page
 * can tell you about them is where each one thinks the truth lives, because
 * that is what decides whether it stacks on top of a repository-first
 * toolchain or wants to replace it.
 *
 * Facts come from the dated notes in docs/research/competitors/business/.
 */

export interface Platform {
  name: string
  /** Who owns it — ownership churn is a real procurement consideration. */
  owner: string
  /** Where the authoritative copy of a string lives. */
  truth: string
  po: string
  note: string
}

export const PLATFORMS_RESEARCHED = "July 2026"

export const PLATFORMS: Platform[] = [
  {
    name: "Crowdin",
    owner: "Crowdin OÜ, bootstrapped, founded 2009",
    truth: "Hosted project database",
    po: "First-class, among 50–100+ formats",
    note: "Deep AI layer and a mature GitHub sync. Git and files are sync targets rather than the origin, and there is no self-hosting.",
  },
  {
    name: "Lokalise",
    owner: "Adobe-owned via Semrush",
    truth: "Hosted keys, server-side branches",
    po: "Yes, including msgctxt and fuzzy flags",
    note: "Strong .po fidelity. Priced on processed words per year, with two of four tiers sales-gated, and now inside a very large acquirer.",
  },
  {
    name: "Phrase",
    owner: "Private-equity owned (Carlyle)",
    truth: "Hosted key and segment database",
    po: "Yes, one among 50+ formats",
    note: "The broadest enterprise suite here — Strings, TMS, Studio, Language AI. Priced accordingly, and files are import/export targets.",
  },
  {
    name: "Transifex",
    owner: "XTM International (2025)",
    truth: "Hosted resources",
    po: "Yes",
    note: "Open-source origins, proprietary since 2013, acquired in 2025. Hosted-word tiers with a separate AI-words SKU.",
  },
  {
    name: "Weblate",
    owner: "Weblate s.r.o., self-funded, no VC",
    truth: "The git repository itself",
    po: "Foundational — bilingual semantics preserved",
    note: "The closest philosophical match to Palamedes: GPLv3, self-hostable, and it treats your repository as the source of truth rather than a mirror.",
  },
  {
    name: "locize",
    owner: "inweso GmbH, run by the i18next maintainers",
    truth: "Hosted namespace and key database",
    po: "Via converter — keys and values only",
    note: "Purpose-built around i18next, and its revenue funds that project. PO export does not preserve file structure, so it is a lossy handover.",
  },
]
