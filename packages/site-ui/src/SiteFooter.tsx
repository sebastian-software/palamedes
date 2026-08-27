import type { CSSProperties } from "react"

import { SiteLink } from "./SiteUiProvider"
import type { SiteBuildMetadata, SiteConfig } from "./types"
import { Wordmark } from "./Wordmark"

function formatBuildTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`
}

export function SiteFooter({ config, build }: { config: SiteConfig; build?: SiteBuildMetadata }) {
  const columns = config.counterpart?.enabled
    ? [
        ...config.footerColumns,
        {
          title: "Palamedes",
          links: [{ label: config.counterpart.label, href: config.counterpart.href }],
        },
      ]
    : config.footerColumns

  return (
    <footer className="pmds-footer">
      <div
        className="pmds-footer-grid"
        style={{ "--pmds-footer-columns": columns.length } as CSSProperties}
      >
        {columns.map((column) => (
          <div key={column.title} className="pmds-footer-column">
            <h4 className="pmds-footer-title">{column.title}</h4>
            <ul className="pmds-footer-links">
              {column.links.map((link) => (
                <li key={`${link.label}:${link.href}`}>
                  <SiteLink href={link.href} className="pmds-footer-link">
                    {link.label}
                  </SiteLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="pmds-footer-meta">
        <p className="pmds-footer-copyright">
          <span>{config.copyright}</span>
          {build ? (
            <span className="pmds-footer-build">
              Build <time dateTime={build.builtAt}>{formatBuildTime(build.builtAt)}</time>
              {" · "}
              <span className="pmds-footer-build-hash">{build.commitHash.slice(0, 8)}</span>
            </span>
          ) : null}
        </p>
        <Wordmark className="pmds-footer-wordmark">{config.footerWordmark ?? config.name}</Wordmark>
      </div>
    </footer>
  )
}
