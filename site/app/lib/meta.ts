import { SITE_ORIGIN } from "~/data/links"

/*
 * Shared per-route meta: title/description plus canonical link and Open
 * Graph tags on the canonical https://palamedes.dev origin. `path` is the
 * site-relative route ("/", "/proof", …).
 */
export function pageMeta({
  title,
  description,
  path,
}: {
  title: string
  description: string
  path: string
}) {
  const url = path === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`
  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Palamedes" },
    { property: "og:url", content: url },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: `${SITE_ORIGIN}/og-image.png` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
  ]
}

/*
 * Topic pages additionally emit JSON-LD: a TechArticle describing the page and
 * a FAQPage built from its own Q&A section. React Router renders
 * `script:ld+json` descriptors as real <script> tags in the prerendered HTML,
 * so this survives with JavaScript disabled — which is the only state a
 * crawler is guaranteed to see.
 *
 * The FAQ entries are the same ones rendered on the page. Marking up answers
 * that are not visible is exactly the kind of thing that gets structured data
 * ignored, so the two must stay in sync by construction rather than by care.
 */
export function topicMeta({
  title,
  description,
  path,
  faq,
}: {
  title: string
  description: string
  path: string
  faq: { q: string; a: string }[]
}) {
  const url = `${SITE_ORIGIN}${path}`
  return [
    ...pageMeta({ title, description, path }),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "TechArticle",
        headline: title,
        description,
        url,
        inLanguage: "en",
        isAccessibleForFree: true,
        publisher: {
          "@type": "Organization",
          name: "Sebastian Software GmbH",
          url: SITE_ORIGIN,
        },
      },
    },
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map((entry) => ({
          "@type": "Question",
          name: entry.q,
          acceptedAnswer: { "@type": "Answer", text: entry.a },
        })),
      },
    },
  ]
}
