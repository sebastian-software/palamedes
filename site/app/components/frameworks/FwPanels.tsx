import { Link } from "react-router"

import { frameworkLandingHref } from "~/data/framework-landing"
import { cellFor } from "~/data/matrix"
import { repoHref } from "~/data/links"

/* Per-framework panels — copy verbatim from FrameworksPage.jsx. */

interface FwPanel {
  name: string
  slug: string
  body: string
  matrixSlug?: string
  sourcePath: string
}

const PANELS: FwPanel[] = [
  {
    name: "Next.js",
    slug: "nextjs",
    matrixSlug: "nextjs",
    sourcePath: "examples/nextjs-route",
    body: "App Router with server components and server actions. The @palamedes/next-plugin handles the host-specific build wiring; authoring, catalogs, and runtime access stay on the shared model.",
  },
  {
    name: "TanStack Start",
    slug: "tanstack",
    matrixSlug: "tanstack",
    sourcePath: "examples/tanstack-route",
    body: "Server functions and file-based routing, integrated through @palamedes/vite-plugin. Locale resolution runs in a server function; the client stays island-light.",
  },
  {
    name: "Solid",
    slug: "solid",
    matrixSlug: "solid",
    sourcePath: "examples/solid-route",
    body: "Solid-native rich-message rendering with @palamedes/solid — the same macro authoring, hook-free lookup, and catalogs as React.",
  },
  {
    name: "Waku",
    slug: "waku",
    matrixSlug: "waku",
    sourcePath: "examples/waku-route",
    body: "Minimal RSC framework. Waku exercises the request-local runtime model through a different server integration, which is why it belongs in the matrix.",
  },
  {
    name: "React Router",
    slug: "react-router",
    matrixSlug: "react-router",
    sourcePath: "examples/react-router-route",
    body: "Framework-mode React Router with loaders and actions. The classic SPA-plus-SSR shape, same catalogs, same runtime.",
  },
  {
    name: "Remix v3",
    slug: "remix",
    matrixSlug: "remix",
    sourcePath: "examples/remix-cookie",
    body: "The new Remix stack — not React Router Framework Mode and not React. Node and browser asset loaders cover ordinary and rich Remix UI macros; the cookie example proves SSR, hydration, interaction, and full-document locale navigation.",
  },
  {
    name: "Vite",
    slug: "vite",
    sourcePath: "packages/vite-plugin",
    body: "The shared build integration behind the TanStack Start, Solid, Waku, and React Router families. Use it directly with React or Solid for macro transforms, PO imports, and build diagnostics.",
  },
]

export function FwPanels() {
  return (
    <div className="border border-hair">
      {PANELS.map((panel, index) => {
        const cookie = panel.matrixSlug ? cellFor(panel.matrixSlug, "cookie") : undefined
        const route = panel.matrixSlug ? cellFor(panel.matrixSlug, "route") : undefined
        const subdomain = panel.matrixSlug ? cellFor(panel.matrixSlug, "subdomain") : undefined
        const tld = panel.matrixSlug ? cellFor(panel.matrixSlug, "tld") : undefined
        const hasLiveDemos = Boolean(cookie?.demoLinks?.length)
        return (
          <div
            key={panel.slug}
            className={`grid grid-cols-[180px_1fr] gap-8 px-6 py-6 max-grid:grid-cols-1 max-grid:gap-3 ${
              index > 0 ? "border-t border-hair" : ""
            }`}
          >
            <div>
              <h3 className="text-[15px] font-bold">
                <Link
                  to={frameworkLandingHref(panel.slug)}
                  viewTransition
                  className="hover:text-accent"
                >
                  {panel.name}
                </Link>
              </h3>
              <p className="mono-nums mt-1 text-[10px] text-gray-spec">
                {panel.matrixSlug ? `examples/${panel.matrixSlug}-*` : panel.sourcePath}
              </p>
            </div>
            <div>
              <p className="max-w-[52em] text-[13.5px] leading-relaxed text-ink/85">{panel.body}</p>
              <p className="mono-nums mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[12px]">
                {cookie?.demoLinks?.map((link) => (
                  <a key={link.href} href={link.href} className="text-accent hover:text-ink">
                    <span aria-hidden>● </span>cookie
                  </a>
                ))}
                {panel.matrixSlug && !hasLiveDemos ? (
                  <span className="text-gray-spec">◌ local / CI</span>
                ) : null}
                {route?.demoLinks?.[0] ? (
                  <a href={route.demoLinks[0].href} className="text-accent hover:text-ink">
                    <span aria-hidden>● </span>route
                  </a>
                ) : null}
                {subdomain?.demoLinks?.[0] ? (
                  <a href={subdomain.demoLinks[0].href} className="text-accent hover:text-ink">
                    <span aria-hidden>● </span>subdomain
                  </a>
                ) : hasLiveDemos ? (
                  <span className="text-gray-spec">◌ subdomain</span>
                ) : null}
                {tld?.demoLinks?.[0] ? (
                  <a href={tld.demoLinks[0].href} className="text-accent hover:text-ink">
                    <span aria-hidden>{tld.status === "live" ? "● " : "◌ "}</span>tld
                    {tld.status === "provisioning" ? (
                      <span className="sr-only"> (host pending)</span>
                    ) : null}
                  </a>
                ) : hasLiveDemos ? (
                  <span className="text-gray-spec">◌ tld</span>
                ) : null}
                <Link
                  to={frameworkLandingHref(panel.slug)}
                  viewTransition
                  className="text-accent hover:text-ink"
                >
                  i18n guide →
                </Link>
                <a
                  href={repoHref(panel.sourcePath, "tree")}
                  className="text-gray-spec hover:text-accent"
                >
                  source →
                </a>
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
