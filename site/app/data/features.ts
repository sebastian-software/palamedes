import { repoHref } from "./links"

/* Feature-cell copy, verbatim from the page specs. */

export type FeatureIconName =
  | "pen"
  | "fingerprint"
  | "plug"
  | "cookie"
  | "route"
  | "globe"
  | "flag"
  | "book"
  | "compass"
  | "server"
  | "arrows"
  | "wrench"
  | "robot"
  | "shield"
  | "brackets"
  | "merge"

export interface FeatureCard {
  icon: FeatureIconName
  title: string
  body: string
  href?: string
}

export const HOME_MODEL_CARDS: FeatureCard[] = [
  {
    icon: "pen",
    title: "Write messages in place",
    body: "Macro-style authoring next to your JSX. No message-ID bookkeeping, no separate dictionary files to keep in sync.",
    href: "/get-started",
  },
  {
    icon: "fingerprint",
    title: "One identity model",
    body: "Messages are identified by message + context — stable across refactors, frameworks, and years of catalog history.",
    href: repoHref("adr/003-source-string-first-message-identity.md"),
  },
  {
    icon: "plug",
    title: "One runtime call",
    body: "getI18n() resolves the active instance everywhere: server components, client islands, backend request handlers.",
    href: repoHref("adr/005-universal-geti18n-runtime-model.md"),
  },
]

export const STRATEGY_CARDS: FeatureCard[] = [
  {
    icon: "cookie",
    title: "Cookie",
    body: "One URL for all locales. Best for apps behind login where SEO is irrelevant and switching should be instant.",
  },
  {
    icon: "route",
    title: "Route segment",
    body: "/de/checkout-style paths. The SEO-friendly default for public content with indexable localized pages.",
  },
  {
    icon: "globe",
    title: "Subdomain",
    body: "de.example.com. Clean separation per market, works well with regional CDNs and analytics splits.",
  },
  {
    icon: "flag",
    title: "Top-level domain",
    body: "example.de vs example.com. Maximum market trust; Palamedes maps each domain to its locale.",
  },
]

export const NEXT_STEP_CARDS: FeatureCard[] = [
  {
    icon: "book",
    title: "Plurals, dates & currency",
    body: "ICU MessageFormat with authoring diagnostics that catch mistakes at extract time.",
    href: repoHref("docs/api/core.md"),
  },
  {
    icon: "compass",
    title: "Pick a locale strategy",
    body: "Cookie, route, subdomain, or TLD — with a live demo for each, in your framework.",
    href: "/frameworks",
  },
  {
    icon: "server",
    title: "Localize your backend",
    body: "Request-local i18n for Hono and Express from the same catalogs.",
    href: repoHref("docs/backend-servers.md"),
  },
  {
    icon: "arrows",
    title: "Migrating from Lingui?",
    body: "A step-by-step playbook. Source-string-first .po catalogs are often reusable after an extraction pass; explicit-ID setups need cleanup.",
    href: repoHref("docs/migrate-from-lingui.md"),
  },
  {
    icon: "wrench",
    title: "Something broke?",
    body: "The troubleshooting guide covers the common setup failures with exact error messages.",
    href: repoHref("docs/troubleshooting.md"),
  },
  {
    icon: "robot",
    title: "Using an AI assistant?",
    body: "Point it at llms.txt — the whole API surface in one machine-readable file.",
    href: "/llms.txt",
  },
]

export const CATALOG_QA_CARDS: FeatureCard[] = [
  {
    icon: "shield",
    title: "Structured audits",
    body: "Machine-readable catalog audits catch missing translations, stale entries, and metadata drift in CI.",
  },
  {
    icon: "brackets",
    title: "ICU diagnostics",
    body: "Authoring mistakes in plural/select syntax are flagged at extract time, not at runtime in production.",
  },
  {
    icon: "merge",
    title: "Semantic merging",
    body: "A Git merge driver resolves catalog conflicts by meaning, not by line — no more broken .po files after rebases.",
  },
]
