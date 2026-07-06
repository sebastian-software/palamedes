import { Link } from "react-router"

import { apiHref, decisionHref, docsHref, repoHref } from "~/data/links"

interface FootLink {
  label: string
  href: string
}

const COLUMNS: { title: string; links: FootLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Get started", href: "/get-started" },
      { label: "Framework matrix", href: "/frameworks" },
      { label: "Benchmarks & proof", href: "/proof" },
      { label: "Comparison", href: "/compare" },
    ],
  },
  {
    title: "Documentation",
    links: [
      { label: "5-minute quickstart", href: docsHref("first-working-translation") },
      { label: "API reference", href: apiHref() },
      { label: "Configuration", href: docsHref("configuration") },
      { label: "CLI", href: docsHref("cli") },
      { label: "Troubleshooting", href: docsHref("troubleshooting") },
      { label: "llms.txt", href: "/llms.txt" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Architecture decisions", href: decisionHref() },
      { label: "Stability & versioning", href: docsHref("stability") },
      { label: "Changelog", href: repoHref("CHANGELOG.md") },
      { label: "Security", href: repoHref("SECURITY.md") },
      { label: "MIT license", href: repoHref("LICENSE") },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "Sebastian Software", href: "https://oss.sebastian-software.com/" },
      { label: "Sebastian Werner", href: "https://sebastian-software.de/werner" },
      { label: "Blog", href: "/blog" },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-hair">
      <div className="hairline-grid grid-cols-4 border-0 border-b border-hair max-grid:grid-cols-2 max-tight:grid-cols-1">
        {COLUMNS.map((column) => (
          <div key={column.title} className="bg-paper px-8 py-8 max-tight:px-5">
            <h4 className="micro text-[10.5px] tracking-label text-gray-spec">{column.title}</h4>
            <ul className="mt-4 space-y-2">
              {column.links.map((link) => (
                <li key={link.label}>
                  {/* Static files like /llms.txt are same-origin but not routes. */}
                  {link.href.startsWith("/") && !link.href.includes(".") ? (
                    <Link to={link.href} viewTransition className="text-[13.5px] hover:text-accent">
                      {link.label}
                    </Link>
                  ) : (
                    <a href={link.href} className="text-[13.5px] hover:text-accent">
                      {link.label}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-6 px-8 py-5 max-tight:px-5">
        <p className="mono-nums text-[11px] text-gray-spec">
          MIT © 2026 Sebastian Software GmbH — built in the open, verified in CI.
        </p>
        <span className="display-serif text-[13px] tracking-[0.24em] text-gray-spec uppercase max-tight:hidden">
          Palamedes
        </span>
      </div>
    </footer>
  )
}
