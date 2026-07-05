export const SITE_ORIGIN = "https://palamedes.dev"

export const REPO = "https://github.com/sebastian-software/palamedes"

/*
 * Link contract (docs/site/structure/README.md): everything living in the
 * repository resolves through this single function — GitHub today, docs-site
 * routes later, one place to change.
 */
export function repoHref(path: string, kind: "blob" | "tree" = "blob"): string {
  return `${REPO}/${kind}/main/${path}`
}

export function docsHref(path = ""): string {
  return path === "" ? "/docs" : `/docs/${path.replace(/\.md$/u, "").replace(/\/README$/u, "")}`
}

export function decisionHref(path = ""): string {
  return path === "" ? "/decisions" : `/decisions/${path.replace(/\.md$/u, "")}`
}

export function apiHref(path = ""): string {
  return path === "" ? "/api-reference" : `/api-reference/${path.replace(/\.md$/u, "")}`
}

export function blogHref(path = ""): string {
  return path === "" ? "/blog" : `/blog/${path.replace(/\.md$/u, "")}`
}

export const NPM = (pkg: string) => `https://www.npmjs.com/package/${pkg}`

export const DEMO_NEXTJS_COOKIE = "https://nextjs-cookie.examples.palamedes.dev"
