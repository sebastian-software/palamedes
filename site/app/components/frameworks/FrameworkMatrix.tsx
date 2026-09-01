import { Link } from "react-router"

import contentStats from "~/data/generated/content-stats.json"
import { frameworkLandingHref } from "~/data/framework-landing"
import { cellFor, FRAMEWORKS, STRATEGIES, type MatrixCell } from "~/data/matrix"

function CellContent({ cell }: { cell: MatrixCell }) {
  return (
    <div className="min-w-[9em]">
      <div className="flex items-center gap-2">
        <span className={cell.status === "live" ? "text-accent" : "text-gray-spec"} aria-hidden>
          {cell.status === "live" ? "●" : "◌"}
        </span>
        <span className="mono-nums text-[10px] tracking-label text-gray-spec uppercase">
          ✓ verified{cell.status === "provisioning" ? " · host pending" : ""}
        </span>
      </div>
      <div className="mono-nums mt-2 text-[12px]">
        {cell.demoLinks ? (
          cell.demoLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="mr-1 inline-flex min-h-6 min-w-6 items-center justify-center text-accent underline decoration-transparent underline-offset-2 hover:text-ink hover:decoration-current"
            >
              {link.label}
            </a>
          ))
        ) : (
          <span className="text-gray-spec">public host pending</span>
        )}
      </div>
    </div>
  )
}

/*
 * The 6×4 proof matrix. Cells are explicit data with per-cell hosting
 * status (never a generated URL pattern). Provisioning cells may expose their
 * configured target URLs before the public host becomes live. `scan` enables
 * the /frameworks style break: a one-shot accent scanline sweeping the table
 * on first view.
 */
export function FrameworkMatrix({ scan = false }: { scan?: boolean }) {
  return (
    <div>
      <div
        className="relative overflow-x-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        tabIndex={0}
        aria-label="Verified framework and locale strategy matrix"
      >
        {scan ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-10 h-px bg-accent"
            style={{ animation: "scanline 1.2s ease-out 0.4s both" }}
          />
        ) : null}
        <table className="w-full min-w-[720px] border-collapse border border-hair">
          <thead>
            <tr>
              <th className="micro border border-hair px-4 py-3 text-left text-[10px] tracking-th text-gray-spec">
                Framework
              </th>
              {STRATEGIES.map((strategy) => (
                <th
                  key={strategy.slug}
                  className="border border-hair px-4 py-3 text-left align-top"
                >
                  <span className="micro block text-[10px] tracking-th text-ink">
                    {strategy.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {FRAMEWORKS.map((framework) => (
              <tr key={framework.slug}>
                <th
                  scope="row"
                  className="border border-hair px-4 py-4 text-left align-top text-[14px] font-bold"
                >
                  <Link
                    to={frameworkLandingHref(framework.slug)}
                    viewTransition
                    className="hover:text-accent"
                  >
                    {framework.name}
                  </Link>
                </th>
                {STRATEGIES.map((strategy) => (
                  <td key={strategy.slug} className="border border-hair px-4 py-4 align-top">
                    <CellContent cell={cellFor(framework.slug, strategy.slug)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mono-nums mt-3 text-[11px] text-gray-spec">
        <span className="text-accent">●</span> public demo · ◌ public host pending · ✓ verified in
        CI — Remix v3 has a focused browser proof; public hosting is pending.
      </p>
    </div>
  )
}
