import type { ComponentType, ReactNode } from "react"

export interface SiteLinkDefinition {
  label: string
  href: string
}

export interface SiteNavigationItem extends SiteLinkDefinition {
  active?: boolean
}

export interface SiteFooterColumn {
  title: string
  links: SiteLinkDefinition[]
}

export interface SiteCounterpart extends SiteLinkDefinition {
  enabled: boolean
}

export interface SiteConfig {
  name: string
  homeHref: string
  logoSrc?: string
  logoAlt?: string
  navigation: SiteNavigationItem[]
  primaryAction?: SiteLinkDefinition
  counterpart?: SiteCounterpart
  footerColumns: SiteFooterColumn[]
  copyright: ReactNode
  footerWordmark?: string
}

export interface SiteLinkComponentProps {
  href: string
  className?: string
  children: ReactNode
  ariaLabel?: string
}

export interface SiteUiProviderProps {
  children: ReactNode
  linkComponent?: ComponentType<SiteLinkComponentProps>
}

export type ButtonVariant = "primary" | "outline" | "small"

export interface ButtonLinkProps {
  variant?: ButtonVariant
  href: string
  children: ReactNode
  className?: string
  ariaLabel?: string
}
