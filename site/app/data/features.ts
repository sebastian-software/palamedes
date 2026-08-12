import { decisionHref, docsHref } from "./links"
import type { StrategySlug } from "./matrix"

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

export interface StrategyCard extends FeatureCard {
  slug: StrategySlug
}

export const STRATEGY_CARDS: StrategyCard[] = [
  {
    slug: "cookie",
    icon: "cookie",
    title: "Cookie",
    body: "One URL for all locales. Best for apps behind login where SEO is irrelevant and switching should be instant.",
  },
  {
    slug: "route",
    icon: "route",
    title: "Route segment",
    body: "/de/checkout-style paths. The SEO-friendly default for public content with indexable localized pages.",
  },
  {
    slug: "subdomain",
    icon: "globe",
    title: "Subdomain",
    body: "de.example.com. Clean separation per market, works well with regional CDNs and analytics splits.",
  },
  {
    slug: "tld",
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
    href: docsHref("api/core"),
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
    href: docsHref("backend-servers"),
  },
  {
    icon: "arrows",
    title: "Migrating from Lingui?",
    body: "A step-by-step playbook. Source-string-first .po catalogs are often reusable after an extraction pass; explicit-ID setups need cleanup.",
    href: docsHref("migrate-from-lingui"),
  },
  {
    icon: "wrench",
    title: "Something broke?",
    body: "The troubleshooting guide covers the common setup failures with exact error messages.",
    href: docsHref("troubleshooting"),
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
