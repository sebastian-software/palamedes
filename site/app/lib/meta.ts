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
  ]
}
