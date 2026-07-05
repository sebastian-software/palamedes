import { Link } from "react-router"

import { repoHref } from "~/data/links"

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
      { label: "5-minute quickstart", href: repoHref("docs/first-working-translation.md") },
      { label: "API reference", href: repoHref("docs/api/README.md") },
      { label: "Configuration", href: repoHref("docs/configuration.md") },
      { label: "CLI", href: repoHref("docs/cli.md") },
      { label: "Troubleshooting", href: repoHref("docs/troubleshooting.md") },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "Architecture decisions", href: repoHref("adr", "tree") },
      { label: "Stability & versioning", href: repoHref("docs/stability.md") },
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
                  {link.href.startsWith("/") ? (
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
      <p className="mono-nums px-8 py-5 text-[11px] text-gray-spec max-tight:px-5">
        MIT © 2026 Sebastian Software GmbH — built in the open, verified in CI.
      </p>
    </footer>
  )
}
