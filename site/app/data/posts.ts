import { blogHref } from "./links"

/* Verbatim from docs/site/structure/pages/BlogIndexPage.jsx. */

export interface Post {
  title: string
  excerpt: string
  href: string
  readMinutes: number
}

export const POSTS: Post[] = [
  {
    title: "The third time I built JavaScript i18n tooling",
    excerpt:
      "From qooxdoo's gettext macros to an enterprise Lingui migration to Palamedes — what repeats, what finally changed, and why the third design is source-string-first all the way down.",
    href: blogHref("the-third-time-i-built-javascript-i18n-tooling"),
    readMinutes: 8,
  },
  {
    title: "A calmer path for JavaScript i18n",
    excerpt:
      "Why 'calm' is a feature: one runtime model, one identity model, and a catalog workflow that doesn't reopen with every framework decision.",
    href: blogHref("a-calmer-path-for-javascript-i18n"),
    readMinutes: 6,
  },
  {
    title: "Measuring Palamedes honestly",
    excerpt:
      "Benchmarks are easy to game and easy to distrust. Here is the methodology: same corpus, semantic validation after every run, checked-in reports anyone can re-run.",
    href: blogHref("measuring-palamedes-honestly"),
    readMinutes: 7,
  },
  {
    title: "Browser-verifying i18n across five frameworks",
    excerpt:
      "How 20 example apps get driven by the same Playwright flow in CI — and why versioned screenshots beat compatibility tables.",
    href: blogHref("browser-verifying-i18n-across-five-frameworks"),
    readMinutes: 6,
  },
  {
    title: "What we delegated to Ferrocat and why",
    excerpt:
      "Why Palamedes keeps catalog parsing, ICU diagnostics, merge behavior, and storage semantics in Ferrocat instead of spreading them across every adapter.",
    href: blogHref("what-we-delegated-to-ferrocat-and-why"),
    readMinutes: 7,
  },
  {
    title: "From Lingui to Palamedes without changing how authoring feels",
    excerpt:
      "A migration story for teams that want familiar macro-shaped authoring while moving the machinery underneath to a stricter source-string-first foundation.",
    href: blogHref("from-lingui-to-palamedes"),
    readMinutes: 7,
  },
  {
    title: "Round 1 micro-content",
    excerpt:
      "Short proof-led posts for the first Palamedes content round, each tied to one concrete repository-backed evidence point.",
    href: blogHref("micro-content-round-1"),
    readMinutes: 4,
  },
]
