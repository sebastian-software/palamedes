import { repoHref } from "./links";

/* Public links follow the accepted deployment manifest in docs/demo-deployments.md.
 * Component demos share one source directory across their four locale strategies.
 */

export type MatrixStatus = "live" | "provisioning";

export interface DemoLink {
  label: string;
  href: string;
}

export interface MatrixCell {
  framework: string;
  strategy: StrategySlug;
  verified: true;
  status: MatrixStatus;
  demoLinks?: DemoLink[];
  sourceHref: string;
}

export interface MatrixAxis<TSlug extends string = string> {
  name: string;
  slug: TSlug;
}

export type StrategySlug = "cookie" | "route" | "subdomain" | "tld";

interface FrameworkAxis extends MatrixAxis {
  rendering: "ssr" | "client";
}

export const FRAMEWORKS: FrameworkAxis[] = [
  { name: "Next.js", slug: "nextjs", rendering: "ssr" },
  { name: "TanStack Start", slug: "tanstack", rendering: "ssr" },
  { name: "Solid 2 with Start Mode", slug: "solid", rendering: "ssr" },
  { name: "Waku", slug: "waku", rendering: "ssr" },
  { name: "React Router", slug: "react-router", rendering: "ssr" },
  { name: "Remix", slug: "remix", rendering: "ssr" },
  { name: "Vue + Vite", slug: "vue", rendering: "client" },
  { name: "Nuxt", slug: "nuxt", rendering: "ssr" },
  { name: "Svelte + Vite", slug: "svelte", rendering: "client" },
  { name: "SvelteKit", slug: "sveltekit", rendering: "ssr" },
];

export const STRATEGIES: MatrixAxis<StrategySlug>[] = [
  { name: "Cookie", slug: "cookie" },
  { name: "Route", slug: "route" },
  { name: "Subdomain", slug: "subdomain" },
  { name: "TLD", slug: "tld" },
];

const HOSTED_FRAMEWORKS = new Set([
  "nextjs",
  "tanstack",
  "solid",
  "waku",
  "react-router",
  "remix",
  "vue",
  "nuxt",
  "svelte",
  "sveltekit",
]);
const COMPONENT_SOURCES: Partial<Record<string, string>> = {
  vue: "proof/vue-vite",
  nuxt: "proof/nuxt-ssr",
  svelte: "proof/svelte-vite",
  sveltekit: "proof/sveltekit-ssr",
};
function sourceHref(framework: string, strategy: StrategySlug) {
  return repoHref(COMPONENT_SOURCES[framework] ?? `examples/${framework}-${strategy}`, "tree");
}

export const MATRIX_CELLS: MatrixCell[] = FRAMEWORKS.flatMap(({ slug: framework }) => [
  {
    framework,
    strategy: "cookie",
    verified: true as const,
    status: HOSTED_FRAMEWORKS.has(framework) ? ("live" as const) : ("provisioning" as const),
    demoLinks: HOSTED_FRAMEWORKS.has(framework)
      ? [{ label: "open", href: `https://${framework}-cookie.examples.palamedes.dev` }]
      : undefined,
    sourceHref: sourceHref(framework, "cookie"),
  },
  {
    framework,
    strategy: "route",
    verified: true as const,
    status: HOSTED_FRAMEWORKS.has(framework) ? ("live" as const) : ("provisioning" as const),
    demoLinks: HOSTED_FRAMEWORKS.has(framework)
      ? ["en", "de", "es", "fr"].map((locale) => ({
          label: locale,
          href: `https://${framework}-route.examples.palamedes.dev/${locale}`,
        }))
      : undefined,
    sourceHref: sourceHref(framework, "route"),
  },
  {
    framework,
    strategy: "subdomain",
    verified: true as const,
    status: HOSTED_FRAMEWORKS.has(framework) ? ("live" as const) : ("provisioning" as const),
    demoLinks: HOSTED_FRAMEWORKS.has(framework)
      ? ["en", "de", "es", "fr"].map((locale) => ({
          label: locale,
          href: `https://${locale}.${framework}-subdomain.examples.palamedes.dev`,
        }))
      : undefined,
    sourceHref: sourceHref(framework, "subdomain"),
  },
  {
    framework,
    strategy: "tld",
    verified: true as const,
    status: HOSTED_FRAMEWORKS.has(framework) ? ("live" as const) : ("provisioning" as const),
    demoLinks: HOSTED_FRAMEWORKS.has(framework)
      ? [
          { label: "en", href: `https://${framework}.examples.palamedes-i18n.com` },
          { label: "de", href: `https://${framework}.examples.palamedes-i18n.de` },
          { label: "es", href: `https://${framework}.examples.palamedes-i18n.es` },
          { label: "fr", href: `https://${framework}.examples.palamedes-i18n.fr` },
        ]
      : undefined,
    sourceHref: sourceHref(framework, "tld"),
  },
]);

export function cellFor(framework: string, strategy: StrategySlug): MatrixCell {
  const cell = MATRIX_CELLS.find((c) => c.framework === framework && c.strategy === strategy);
  if (!cell) {
    throw new Error(`No matrix cell for ${framework}/${strategy}`);
  }
  return cell;
}
