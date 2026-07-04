/**
 * Route: /blog
 * Job: founder-led content hub. Sources the existing posts from
 * docs/site/posts/ and gives the project a voice between releases.
 * Strategy notes live in docs/founder-led-content.md.
 */

export function BlogIndexPage() {
  return (
    <Page title="Palamedes blog — notes from building i18n tooling in the open">
      <SiteNav />

      <Hero
        eyebrow="Blog"
        headline="Building i18n tooling in the open."
        subline="Design notes, honest benchmarks, and lessons from the third
          time around — written by the maintainer, not a content team."
      />

      <Section id="posts">
        <PostList>
          <PostCard
            post={{
              title: "The third time I built JavaScript i18n tooling",
              excerpt:
                "From qooxdoo's gettext macros to an enterprise Lingui migration to Palamedes — what repeats, what finally changed, and why the third design is source-string-first all the way down.",
              href: "…/docs/site/posts/the-third-time-i-built-javascript-i18n-tooling.md",
              readMinutes: 8,
            }}
          />
          <PostCard
            post={{
              title: "A calmer path for JavaScript i18n",
              excerpt:
                "Why 'calm' is a feature: one runtime model, one identity model, and a catalog workflow that doesn't reopen with every framework decision.",
              href: "…/docs/site/posts/a-calmer-path-for-javascript-i18n.md",
              readMinutes: 6,
            }}
          />
          <PostCard
            post={{
              title: "Measuring Palamedes honestly",
              excerpt:
                "Benchmarks are easy to game and easy to distrust. Here is the methodology: same corpus, semantic validation after every run, checked-in reports anyone can re-run.",
              href: "…/docs/site/posts/measuring-palamedes-honestly.md",
              readMinutes: 7,
            }}
          />
          <PostCard
            post={{
              title: "Browser-verifying i18n across five frameworks",
              excerpt:
                "How 20 example apps get driven by the same Playwright flow in CI — and why versioned screenshots beat compatibility tables.",
              href: "…/docs/site/posts/browser-verifying-i18n-across-five-frameworks.md",
              readMinutes: 6,
            }}
          />
        </PostList>
      </Section>

      <CtaBand
        headline="Prefer reading code to reading posts?"
        primary={{
          label: "Browse the repo",
          href: "https://github.com/sebastian-software/palamedes",
        }}
        secondary={{ label: "Get started", href: "/get-started" }}
      />

      <SiteFooter />
    </Page>
  )
}
