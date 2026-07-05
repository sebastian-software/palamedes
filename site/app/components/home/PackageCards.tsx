import { NPM } from "~/data/links"
import { PACKAGES } from "~/data/packages"

export function PackageCards() {
  return (
    <div className="hairline-grid grid-cols-4 max-grid:grid-cols-2 max-tight:grid-cols-1">
      {PACKAGES.map((pkg) => (
        <a
          key={pkg.name}
          href={NPM(pkg.name)}
          className="group bg-paper px-5 py-5 transition-colors hover:bg-hover-fill"
        >
          <p className="mono-nums text-[12px] text-accent">{pkg.name}</p>
          <p className="mt-2 text-[12.5px] leading-snug text-gray-spec">{pkg.role}</p>
          <p className="micro mt-3 text-[10px] text-gray-spec group-hover:text-accent">npm →</p>
        </a>
      ))}
      <div className="flex items-center bg-paper px-5 py-5">
        <p className="text-[12.5px] text-gray-spec">
          The top-level <code>palamedes</code> name is reserved — the scoped packages above are the
          install path today.
        </p>
      </div>
    </div>
  )
}
