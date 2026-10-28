import { decisionHref, docsHref } from "./links";
import type { StrategySlug } from "./matrix";

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
  | "merge";

export interface FeatureCard {
  icon: FeatureIconName;
  title: string;
  body: string;
  href?: string;
}

export interface StrategyCard extends FeatureCard {
  slug: StrategySlug;
}

export const RUNTIME_BENEFITS: FeatureCard[] = [
  {
    icon: "brackets",
    title: "Compiled messages, no runtime ICU parser",
    body: "ICU stays in your source and catalogs. Compilation checks it and emits executable messages for development and production, so application runtimes do not parse it during rendering.",
    href: docsHref("migration-v2"),
  },
  {
    icon: "arrows",
    title: "Translation fragments follow your code",
    body: "Browser adapters select the active document locale and load a module's message dependencies before it runs. Lazy application modules bring their additional translation fragments with them.",
    href: "/frameworks",
  },
  {
    icon: "server",
    title: "Shared catalogs, isolated requests",
    body: "Servers load a complete active-locale catalog on demand and share its immutable messages. Each request keeps its own locale and formatter state without rebuilding the full message map.",
    href: docsHref("migration-v2"),
  },
];

export const STRATEGY_CARDS: StrategyCard[] = [
  {
    slug: "cookie",
    icon: "cookie",
    title: "Cookie",
    body: "One URL for all locales. Useful for signed-in apps; an explicit language choice is persisted and opens a new document in that locale.",
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
    title: "Top-level domain (TLD)",
    body: "product.com to product.de. Palamedes replaces the final DNS label and keeps the rest of the hostname; paths have no locale prefix.",
  },
];

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
    body: "Choose cookie, route prefix, subdomain, TLD, or explicit language domains. Compare the URL policies and their verification coverage.",
    href: "/locale-routing",
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
    body: "Use the repository skill for Next.js or Vite/React setup and Lingui migration. It checks the target version, preserves catalogs, and verifies the rendered result.",
    href: docsHref("agent-skill"),
  },
];

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
];
