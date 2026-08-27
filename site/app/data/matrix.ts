import { repoHref } from "./links"

/*
 * Cells carry EXPLICIT links and a per-cell hosting status — never a generated
 * URL pattern. Hosting truth lives in docs/demo-deployments.md; keep this file
 * in sync with it. URL shapes mirror examples/README.md: cookie (one host),
 * route (locale path), subdomain (locale host label), tld
 * (palamedes-i18n.{com,de,es,fr}). Cookie, route, and subdomain are hosted for
 * four browser-verified frameworks; Solid's renamed v2 hosts remain in
 * provisioning. Tld target URLs for all five browser-capable families are
 * published as rollout probes while reverse-proxy routing and TLS remain in
 * provisioning. Remix v3 is a local/CI proof surface without public hosting.
 */

export type MatrixStatus = "live" | "provisioning"

export interface DemoLink {
  label: string
  href: string
}

export interface MatrixCell {
  framework: string
  strategy: StrategySlug
  verified: true
  status: MatrixStatus
  demoLinks?: DemoLink[]
  sourceHref: string
}

export interface MatrixAxis<TSlug extends string = string> {
  name: string
  slug: TSlug
}

export type StrategySlug = "cookie" | "route" | "subdomain" | "tld"

export const FRAMEWORKS: MatrixAxis[] = [
  { name: "Next.js", slug: "nextjs" },
  { name: "TanStack Start", slug: "tanstack" },
  { name: "Solid", slug: "solid" },
  { name: "Waku", slug: "waku" },
  { name: "React Router", slug: "react-router" },
  { name: "Remix v3", slug: "remix" },
]

export const STRATEGIES: MatrixAxis<StrategySlug>[] = [
  { name: "Cookie", slug: "cookie" },
  { name: "Route", slug: "route" },
  { name: "Subdomain", slug: "subdomain" },
  { name: "TLD", slug: "tld" },
]

const HOSTED_FRAMEWORKS = new Set(["nextjs", "tanstack", "waku", "react-router"])
const TLD_FRAMEWORKS = new Set(["nextjs", "tanstack", "solid", "waku", "react-router"])

export const MATRIX_CELLS: MatrixCell[] = FRAMEWORKS.flatMap(({ slug: framework }) => [
  {
    framework,
    strategy: "cookie",
    verified: true as const,
    status: HOSTED_FRAMEWORKS.has(framework) ? ("live" as const) : ("provisioning" as const),
    demoLinks: HOSTED_FRAMEWORKS.has(framework)
      ? [{ label: "open", href: `https://${framework}-cookie.examples.palamedes.dev` }]
      : undefined,
    sourceHref: repoHref(`examples/${framework}-cookie`, "tree"),
  },
  {
    framework,
    strategy: "route",
    verified: true as const,
    status: HOSTED_FRAMEWORKS.has(framework) ? ("live" as const) : ("provisioning" as const),
    demoLinks: HOSTED_FRAMEWORKS.has(framework)
      ? ["en", "de", "es"].map((locale) => ({
          label: locale,
          href: `https://${framework}-route.examples.palamedes.dev/${locale}`,
        }))
      : undefined,
    sourceHref: repoHref(`examples/${framework}-route`, "tree"),
  },
  {
    framework,
    strategy: "subdomain",
    verified: true as const,
    status: HOSTED_FRAMEWORKS.has(framework) ? ("live" as const) : ("provisioning" as const),
    demoLinks: HOSTED_FRAMEWORKS.has(framework)
      ? ["en", "de", "es"].map((locale) => ({
          label: locale,
          href: `https://${locale}.${framework}-subdomain.examples.palamedes.dev`,
        }))
      : undefined,
    sourceHref: repoHref(`examples/${framework}-subdomain`, "tree"),
  },
  {
    framework,
    strategy: "tld",
    verified: true as const,
    status: "provisioning" as const,
    demoLinks: TLD_FRAMEWORKS.has(framework)
      ? [
          { label: "en", href: `https://${framework}.examples.palamedes-i18n.com` },
          { label: "de", href: `https://${framework}.examples.palamedes-i18n.de` },
          { label: "es", href: `https://${framework}.examples.palamedes-i18n.es` },
          { label: "fr", href: `https://${framework}.examples.palamedes-i18n.fr` },
        ]
      : undefined,
    sourceHref: repoHref(`examples/${framework}-tld`, "tree"),
  },
])

export function cellFor(framework: string, strategy: StrategySlug): MatrixCell {
  const cell = MATRIX_CELLS.find((c) => c.framework === framework && c.strategy === strategy)
  if (!cell) {
    throw new Error(`No matrix cell for ${framework}/${strategy}`)
  }
  return cell
}
