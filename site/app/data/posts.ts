import { repoHref } from "./links"

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
    href: repoHref("docs/site/posts/the-third-time-i-built-javascript-i18n-tooling.md"),
    readMinutes: 8,
  },
  {
    title: "A calmer path for JavaScript i18n",
    excerpt:
      "Why 'calm' is a feature: one runtime model, one identity model, and a catalog workflow that doesn't reopen with every framework decision.",
    href: repoHref("docs/site/posts/a-calmer-path-for-javascript-i18n.md"),
    readMinutes: 6,
  },
  {
    title: "Measuring Palamedes honestly",
    excerpt:
      "Benchmarks are easy to game and easy to distrust. Here is the methodology: same corpus, semantic validation after every run, checked-in reports anyone can re-run.",
    href: repoHref("docs/site/posts/measuring-palamedes-honestly.md"),
    readMinutes: 7,
  },
  {
    title: "Browser-verifying i18n across five frameworks",
    excerpt:
      "How 20 example apps get driven by the same Playwright flow in CI — and why versioned screenshots beat compatibility tables.",
    href: repoHref("docs/site/posts/browser-verifying-i18n-across-five-frameworks.md"),
    readMinutes: 6,
  },
]
