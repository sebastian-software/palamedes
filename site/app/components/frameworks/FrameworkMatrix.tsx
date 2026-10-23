import { Link } from "react-router";

import { FrameworkIdentity } from "~/components/FrameworkIdentity";
import { frameworkLandingHref } from "~/data/framework-landing";
import { cellFor, FRAMEWORKS, STRATEGIES, type MatrixCell } from "~/data/matrix";

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
  );
}

/*
 * The 10×4 proof matrix uses the public hosting state in the matrix data.
 * `scan` adds the /frameworks accent scanline on first view.
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
                    <FrameworkIdentity slug={framework.slug} name={framework.name} />
                  </Link>
                  <div className="mt-2">
                    <abbr
                      title={
                        framework.rendering === "ssr"
                          ? "Server-side rendering"
                          : "Client-side rendering"
                      }
                      className="mono-nums inline-block border border-hair px-1.5 py-0.5 text-[10px] leading-4 font-normal tracking-label text-ink no-underline"
                    >
                      {framework.rendering === "ssr" ? "SSR" : "CSR"}
                    </abbr>
                  </div>
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
        <span className="text-accent">●</span> public demo · ✓ verified in CI.
      </p>
      <p className="mono-nums mt-2 max-w-[68em] text-[11px] text-gray-spec">
        <span className="text-ink">SSR</span> = server-rendered HTML with hydration.{" "}
        <span className="text-ink">CSR</span> = client-side rendering in the browser. Labels
        describe these demos across all four locale strategies.
      </p>
    </div>
  );
}
