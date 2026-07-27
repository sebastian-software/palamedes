import { cellFor } from "~/data/matrix"
import { repoHref } from "~/data/links"

/* Per-framework panels — copy verbatim from FrameworksPage.jsx. */

interface FwPanel {
  name: string
  slug: string
  body: string
}

const PANELS: FwPanel[] = [
  {
    name: "Next.js",
    slug: "nextjs",
    body: "App Router with server components and server actions. The @palamedes/next-plugin handles the host-specific build wiring; authoring, catalogs, and runtime access stay on the shared model.",
  },
  {
    name: "TanStack Start",
    slug: "tanstack",
    body: "Server functions and file-based routing, integrated through @palamedes/vite-plugin. Locale resolution runs in a server function; the client stays island-light.",
  },
  {
    name: "SolidStart",
    slug: "solidstart",
    body: "Fine-grained reactivity with @palamedes/solid — the same macro authoring and catalogs as React, no fork of your i18n strategy for a different renderer.",
  },
  {
    name: "Waku",
    slug: "waku",
    body: "Minimal RSC framework. Waku exercises the request-local runtime model through a different server integration, which is why it belongs in the matrix.",
  },
  {
    name: "React Router",
    slug: "react-router",
    body: "Framework-mode React Router with loaders and actions. The classic SPA-plus-SSR shape, same catalogs, same runtime.",
  },
  {
    name: "Remix v3",
    slug: "remix",
    body: "Server-first Remix v3 integration, currently verified as a local and CI smoke-proof surface. It uses the same catalogs and runtime contract while the adapter and hosting story mature.",
  },
]

export function FwPanels() {
  return (
    <div className="border border-hair">
      {PANELS.map((panel, index) => {
        const cookie = cellFor(panel.slug, "cookie")
        const route = cellFor(panel.slug, "route")
        const subdomain = cellFor(panel.slug, "subdomain")
        const tld = cellFor(panel.slug, "tld")
        return (
          <div
            key={panel.slug}
            className={`grid grid-cols-[180px_1fr] gap-8 px-6 py-6 max-grid:grid-cols-1 max-grid:gap-3 ${
              index > 0 ? "border-t border-hair" : ""
            }`}
          >
            <div>
              <h3 className="text-[15px] font-bold">{panel.name}</h3>
              <p className="mono-nums mt-1 text-[10px] text-gray-spec">examples/{panel.slug}-*</p>
            </div>
            <div>
              <p className="max-w-[52em] text-[13.5px] leading-relaxed text-ink/85">{panel.body}</p>
              <p className="mono-nums mt-3 space-x-3 text-[12px]">
                {cookie.demoLinks?.map((link) => (
                  <a key={link.href} href={link.href} className="text-accent hover:text-ink">
                    <span aria-hidden>● </span>cookie
                  </a>
                ))}
                {route.demoLinks?.[0] ? (
                  <a href={route.demoLinks[0].href} className="text-accent hover:text-ink">
                    <span aria-hidden>● </span>route
                  </a>
                ) : null}
                {subdomain.demoLinks?.[0] ? (
                  <a href={subdomain.demoLinks[0].href} className="text-accent hover:text-ink">
                    <span aria-hidden>● </span>subdomain
                  </a>
                ) : (
                  <span className="text-gray-spec">◌ subdomain</span>
                )}
                {tld.demoLinks?.[0] ? (
                  <a href={tld.demoLinks[0].href} className="text-accent hover:text-ink">
                    <span aria-hidden>● </span>tld
                  </a>
                ) : (
                  <span className="text-gray-spec">◌ tld</span>
                )}
                <a
                  href={repoHref(`examples/${panel.slug}-route`, "tree")}
                  className="text-gray-spec hover:text-accent"
                >
                  all source →
                </a>
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
