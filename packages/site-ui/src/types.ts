import type { ComponentType, ReactNode } from "react";

export interface SiteLinkDefinition {
  label: string;
  href: string;
}

export interface SiteNavigationItem extends SiteLinkDefinition {
  active?: boolean;
}

export interface SiteFooterColumn {
  title: string;
  links: SiteLinkDefinition[];
}

export interface SiteBuildMetadata {
  builtAt: string;
  commitHash: string;
}

export interface SiteCounterpart extends SiteLinkDefinition {
  enabled: boolean;
}

/**
 * One entry of the Ferramenta family, already resolved to a label and a
 * destination by the consuming site. The shared chrome never reads the family
 * registry itself: keeping it configuration preserves the React-only
 * dependency contract of this package (ADR-021).
 */
export interface SiteFamilyTool extends SiteLinkDefinition {
  /** Terse job line under the name in the switcher, e.g. "regex engine". */
  job?: string;
  /** True for the tool whose site renders this chrome. */
  current?: boolean;
}

export interface SiteFamilyGroup {
  label: string;
  tools: SiteFamilyTool[];
}

/** Header flyout listing the sibling tools, grouped the way the family groups them. */
export interface SiteToolSwitcher {
  /** Trigger label, e.g. "Tools". */
  label: string;
  /** Accessible name of the flyout region (default: the trigger label). */
  ariaLabel?: string;
  groups: SiteFamilyGroup[];
}

/** One-line family credit for the footer: the family site plus every sibling. */
export interface SiteFamilyLine {
  /** Text of the link to the family site, e.g. "Ferramenta family". */
  label: string;
  /** The family site. */
  href: string;
  tools: SiteFamilyTool[];
}

export interface SiteConfig {
  name: string;
  homeHref: string;
  logoSrc?: string;
  logoAlt?: string;
  navigation: SiteNavigationItem[];
  primaryAction?: SiteLinkDefinition;
  counterpart?: SiteCounterpart;
  /*
   * Family surfaces are opt-in: a site that omits them renders exactly the
   * chrome it renders today, which is how Palamedes+ stays free of the
   * open-source family navigation.
   */
  toolSwitcher?: SiteToolSwitcher;
  familyLine?: SiteFamilyLine;
  footerColumns: SiteFooterColumn[];
  copyright: ReactNode;
  footerWordmark?: string;
}

export interface SiteLinkComponentProps {
  href: string;
  className?: string;
  children: ReactNode;
  ariaLabel?: string;
  /*
   * Set on the entry that points at the site currently being rendered. A
   * consumer adapter that ignores it still satisfies the contract; forwarding
   * it keeps the family surfaces announceable.
   */
  ariaCurrent?: "page";
}

export interface SiteUiProviderProps {
  children: ReactNode;
  linkComponent?: ComponentType<SiteLinkComponentProps>;
}

export type ButtonVariant = "primary" | "outline" | "small";

export interface ButtonLinkProps {
  variant?: ButtonVariant;
  href: string;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}
