import type { ReactNode } from "react"

import { ButtonLink } from "./Button"
import { SiteFooter } from "./SiteFooter"
import { SiteLink } from "./SiteUiProvider"
import type { SiteConfig } from "./types"
import { Wordmark } from "./Wordmark"

export function SiteHeader({ config }: { config: SiteConfig }) {
  return (
    <header className="pmds-site-header">
      <SiteLink href={config.homeHref} className="pmds-site-brand">
        {config.logoSrc ? (
          <img
            src={config.logoSrc}
            alt={config.logoAlt ?? ""}
            className="pmds-site-logo"
            width={36}
            height={36}
          />
        ) : null}
        <Wordmark>{config.name}</Wordmark>
      </SiteLink>
      <nav aria-label="Primary" className="pmds-site-nav">
        {config.navigation.map((link) => (
          <SiteLink
            key={`${link.label}:${link.href}`}
            href={link.href}
            className={`pmds-nav-link${link.active ? " active" : ""}`}
          >
            {link.label}
          </SiteLink>
        ))}
      </nav>
      <div className="pmds-site-actions">
        {config.counterpart?.enabled ? (
          <SiteLink href={config.counterpart.href} className="pmds-counterpart-link">
            {config.counterpart.label}
          </SiteLink>
        ) : null}
        {config.primaryAction ? (
          <ButtonLink variant="small" href={config.primaryAction.href}>
            {config.primaryAction.label}
          </ButtonLink>
        ) : null}
      </div>
    </header>
  )
}

export function SiteShell({ config, children }: { config: SiteConfig; children: ReactNode }) {
  return (
    <>
      <SiteHeader config={config} />
      <main>{children}</main>
      <div className="pmds-shell-footer">
        <SiteFooter config={config} />
      </div>
    </>
  )
}
