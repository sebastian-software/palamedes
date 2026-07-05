import { cellFor, FRAMEWORKS, STRATEGIES, type MatrixCell } from "~/data/matrix"

function CellContent({ cell }: { cell: MatrixCell }) {
  return (
    <div className="min-w-[9em]">
      <div className="flex items-center gap-2">
        <span className={cell.status === "live" ? "text-accent" : "text-gray-spec"} aria-hidden>
          {cell.status === "live" ? "●" : "◌"}
        </span>
        <span className="mono-nums text-[10px] tracking-label text-gray-spec uppercase">
          ✓ verified
        </span>
      </div>
      <div className="mono-nums mt-2 space-x-2 text-[12px]">
        {cell.demoLinks ? (
          cell.demoLinks.map((link) => (
            <a key={link.href} href={link.href} className="text-accent hover:text-ink">
              {link.label}
            </a>
          ))
        ) : (
          <span className="text-gray-spec italic">provisioning</span>
        )}
        <a href={cell.sourceHref} className="text-gray-spec hover:text-accent">
          source
        </a>
      </div>
    </div>
  )
}

/*
 * The 5×4 proof matrix. Cells are explicit data with per-cell hosting
 * status (never a generated URL pattern); subdomain/tld hosting is tracked
 * in issue #306. `scan` enables the /frameworks style break: a one-shot
 * accent scanline sweeping the table on first view.
 */
export function FrameworkMatrix({ scan = false }: { scan?: boolean }) {
  return (
    <div>
      <div className="relative overflow-x-auto">
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
              <th className="micro border border-hair px-4 py-3 text-left text-[10.5px] tracking-th text-gray-spec">
                Framework
              </th>
              {STRATEGIES.map((strategy) => (
                <th
                  key={strategy.slug}
                  className="border border-hair px-4 py-3 text-left align-top"
                >
                  <span className="micro block text-[10.5px] tracking-th text-ink">
                    {strategy.name}
                  </span>
                  <span className="mono-nums text-[10px] text-gray-spec">{strategy.slug}</span>
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
                  {framework.name}
                  <span className="mono-nums mt-1 block text-[10px] font-normal text-gray-spec">
                    {framework.slug}
                  </span>
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
        <span className="text-accent">●</span> live demo · ◌ provisioning (#306) · ✓ CI
        browser-verified — all 20 apps run the same Playwright flow
      </p>
    </div>
  )
}
