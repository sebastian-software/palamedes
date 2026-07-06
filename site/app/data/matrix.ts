import { repoHref } from "./links"

/*
 * Typed port of FRAMEWORK_MATRIX_CELLS from docs/site/structure/components.jsx.
 * Cells carry EXPLICIT links and a per-cell hosting status — never a generated
 * URL pattern. URL shapes mirror examples/README.md: cookie (one host), route
 * (locale path), subdomain (locale host label, live under the per-example
 * wildcards), tld (palamedes-i18n.{com,de,es,fr} — domains still pending, so
 * these stay provisioning). Remaining tld hosting is tracked in issue #306.
 */

export type MatrixStatus = "live" | "provisioning"

export interface DemoLink {
  label: string
  href: string
}

export interface MatrixCell {
  framework: string
  strategy: string
  verified: true
  status: MatrixStatus
  demoLinks?: DemoLink[]
  sourceHref: string
}

export interface MatrixAxis {
  name: string
  slug: string
}

export const FRAMEWORKS: MatrixAxis[] = [
  { name: "Next.js", slug: "nextjs" },
  { name: "TanStack Start", slug: "tanstack" },
  { name: "SolidStart", slug: "solidstart" },
  { name: "Waku", slug: "waku" },
  { name: "React Router", slug: "react-router" },
]

export const STRATEGIES: MatrixAxis[] = [
  { name: "Cookie", slug: "cookie" },
  { name: "Route", slug: "route" },
  { name: "Subdomain", slug: "subdomain" },
  { name: "TLD", slug: "tld" },
]

export const MATRIX_CELLS: MatrixCell[] = FRAMEWORKS.flatMap(({ slug: framework }) => [
  {
    framework,
    strategy: "cookie",
    verified: true as const,
    status: "live" as const,
    demoLinks: [{ label: "open", href: `https://${framework}-cookie.examples.palamedes.dev` }],
    sourceHref: repoHref(`examples/${framework}-cookie`, "tree"),
  },
  {
    framework,
    strategy: "route",
    verified: true as const,
    status: "live" as const,
    demoLinks: ["en", "de", "es"].map((locale) => ({
      label: locale,
      href: `https://${framework}-route.examples.palamedes.dev/${locale}`,
    })),
    sourceHref: repoHref(`examples/${framework}-route`, "tree"),
  },
  {
    framework,
    strategy: "subdomain",
    verified: true as const,
    status: "live" as const,
    demoLinks: ["en", "de", "es"].map((locale) => ({
      label: locale,
      href: `https://${locale}.${framework}-subdomain.examples.palamedes.dev`,
    })),
    sourceHref: repoHref(`examples/${framework}-subdomain`, "tree"),
  },
  {
    framework,
    strategy: "tld",
    verified: true as const,
    status: "provisioning" as const,
    sourceHref: repoHref(`examples/${framework}-tld`, "tree"),
  },
])

export function cellFor(framework: string, strategy: string): MatrixCell {
  const cell = MATRIX_CELLS.find((c) => c.framework === framework && c.strategy === strategy)
  if (!cell) {
    throw new Error(`No matrix cell for ${framework}/${strategy}`)
  }
  return cell
}
