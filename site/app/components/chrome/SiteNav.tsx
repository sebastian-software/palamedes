import { Link, NavLink } from "react-router"

import { repoHref, REPO } from "~/data/links"
import { ButtonLink } from "./Button"

const NAV_ITEMS = [
  { label: "Frameworks", to: "/frameworks" },
  { label: "Proof", to: "/proof" },
  { label: "Compare", to: "/compare" },
  { label: "Blog", to: "/blog" },
]

export function SiteNav() {
  return (
    <nav className="sticky top-0 z-20 border-b border-hair bg-paper">
      <div className="frame flex min-h-14 flex-wrap items-center gap-x-6 gap-y-2 px-8 py-2 max-tight:px-5">
        <Link to="/" viewTransition className="text-[17px] font-bold tracking-tight">
          Palamedes
        </Link>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              viewTransition
              className={({ isActive }) =>
                `micro tracking-nav py-1 transition-colors ${
                  isActive ? "border-b-2 border-accent text-accent" : "text-ink hover:text-accent"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <a
            href={repoHref("docs", "tree")}
            className="micro tracking-nav py-1 text-ink transition-colors hover:text-accent"
          >
            Docs
          </a>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <a href={REPO} className="micro tracking-nav text-gray-spec hover:text-accent">
            GitHub ↗
          </a>
          <ButtonLink variant="small" href="/get-started">
            Get started
          </ButtonLink>
        </div>
      </div>
    </nav>
  )
}
