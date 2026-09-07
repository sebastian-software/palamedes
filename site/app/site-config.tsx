import { FAMILY_SITE, family, familyGroups, type FamilyTool } from "@ferramenta/family/registry";
import type { SiteConfig, SiteFamilyTool, SiteLinkComponentProps } from "@palamedes/site-ui";
import { defineSiteConfig } from "@palamedes/site-ui";
import { Link } from "react-router";

import { apiHref, decisionHref, docsHref, repoHref } from "~/data/links";
import { PRIMARY_NAVIGATION_LINKS } from "~/data/navigation";

export function RouterSiteLink({
  href,
  className,
  children,
  ariaLabel,
  ariaCurrent,
}: SiteLinkComponentProps) {
  /*
   * Route paths get React Router view transitions. Hash links, generated
   * static files, and external origins remain ordinary anchors.
   */
  if (href.startsWith("/") && !href.includes(".")) {
    return (
      <Link
        to={href}
        viewTransition
        className={className}
        aria-label={ariaLabel}
        aria-current={ariaCurrent}
      >
        {children}
      </Link>
    );
  }

  return (
    <a href={href} className={className} aria-label={ariaLabel} aria-current={ariaCurrent}>
      {children}
    </a>
  );
}

/*
 * D6 of the 2026-09 family audit: palamedes.dev keeps its own editorial brand
 * and adds the family switcher plus the footer family line. The facts come from
 * the `@ferramenta/family` registry — names, jobs, and destinations are never
 * copied into this repository (ferramenta ADR-0001). Only the registry entry
 * point is imported: it is data with no React and no CSS, so `site-ui` keeps
 * its React-only dependency contract (ADR-021) and the shared chrome receives
 * plain configuration.
 */
const FAMILY_CURRENT = "palamedes";

function toFamilyTool(tool: FamilyTool): SiteFamilyTool {
  const current = tool.name === FAMILY_CURRENT;
  return {
    label: tool.name,
    /* This site is its own registry destination; link it as a route instead. */
    href: current ? "/" : (tool.docs ?? tool.repo),
    job: tool.shortJob,
    current,
  };
}

const { pipeline, language, workbench } = familyGroups();

export const OSS_SITE_CONFIG: SiteConfig = defineSiteConfig({
  name: "Palamedes",
  homeHref: "/",
  logoSrc: "/logo.svg",
  logoAlt: "Palamedes",
  navigation: PRIMARY_NAVIGATION_LINKS.map(({ label, href }) => ({
    label,
    href,
  })),
  primaryAction: { label: "Get started", href: "/get-started" },
  /*
   * Keep the future product relationship explicit and testable without
   * publishing a dead destination on palamedes.dev before Plus launches.
   */
  counterpart: {
    label: "Palamedes+",
    href: "https://plus.palamedes.dev",
    enabled: false,
  },
  toolSwitcher: {
    label: "Tools",
    ariaLabel: "Ferramenta family tools",
    groups: [
      { label: "Pipeline", tools: pipeline.map(toFamilyTool) },
      { label: "Language", tools: language.map(toFamilyTool) },
      { label: "Workbench", tools: workbench.map(toFamilyTool) },
    ],
  },
  familyLine: {
    label: "Ferramenta family",
    href: FAMILY_SITE,
    tools: family.map(toFamilyTool),
  },
  footerColumns: [
    {
      title: "Product",
      links: [
        { label: "Get started", href: "/get-started" },
        { label: "Framework matrix", href: "/frameworks" },
        { label: "Benchmarks & proof", href: "/proof" },
        { label: "Comparison", href: "/compare" },
        { label: "Guides", href: "/guides" },
      ],
    },
    {
      title: "Documentation",
      links: [
        { label: "Guided quickstart", href: docsHref("first-working-translation") },
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
        { label: "Decision records", href: decisionHref() },
        { label: "Stability & versioning", href: docsHref("stability") },
        { label: "Changelog", href: repoHref("CHANGELOG.md") },
        { label: "Security", href: repoHref("SECURITY.md") },
        { label: "MIT OR Apache-2.0 license", href: repoHref("README.md#license") },
      ],
    },
    {
      title: "Company",
      links: [
        { label: "Sebastian Software", href: "https://oss.sebastian-software.com/" },
        { label: "Sebastian Werner", href: "https://sebastian-software.de/werner" },
        { label: "Icons by Streamline", href: "https://www.streamlinehq.com/" },
        { label: "Blog", href: "/blog" },
      ],
    },
  ],
  copyright:
    "MIT OR Apache-2.0 © 2025–2026 Sebastian Software GmbH — built in the open, verified in CI.",
});
