import type { CSSProperties } from "react"

import { SiteLink } from "./SiteUiProvider"
import type { SiteConfig } from "./types"
import { Wordmark } from "./Wordmark"

export function SiteFooter({ config }: { config: SiteConfig }) {
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
        <p className="pmds-footer-copyright">{config.copyright}</p>
        <Wordmark className="pmds-footer-wordmark">{config.footerWordmark ?? config.name}</Wordmark>
      </div>
    </footer>
  )
}
