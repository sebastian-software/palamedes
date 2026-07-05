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

export const NPM = (pkg: string) => `https://www.npmjs.com/package/${pkg}`

export const DEMO_NEXTJS_COOKIE = "https://nextjs-cookie.examples.palamedes.dev"
