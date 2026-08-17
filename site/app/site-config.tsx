import type { SiteConfig, SiteLinkComponentProps } from "@palamedes/site-ui"
import { defineSiteConfig } from "@palamedes/site-ui"
import { Link } from "react-router"

import { apiHref, decisionHref, docsHref, repoHref } from "~/data/links"

export function RouterSiteLink({ href, className, children, ariaLabel }: SiteLinkComponentProps) {
  /*
   * Route paths get React Router view transitions. Hash links, generated
   * static files, and external origins remain ordinary anchors.
   */
  if (href.startsWith("/") && !href.includes(".")) {
    return (
      <Link to={href} viewTransition className={className} aria-label={ariaLabel}>
        {children}
      </Link>
    )
  }

  return (
    <a href={href} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  )
}

export const OSS_SITE_CONFIG: SiteConfig = defineSiteConfig({
  name: "Palamedes",
  homeHref: "/",
  logoSrc: "/logo.svg",
  logoAlt: "Palamedes",
  navigation: [
    { label: "Frameworks", href: "/frameworks" },
    { label: "Architecture", href: "/architecture" },
    { label: "Guides", href: "/guides" },
    { label: "Docs", href: "/docs" },
  ],
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
        { label: "MIT license", href: repoHref("LICENSE") },
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
  copyright: "MIT © 2026 Sebastian Software GmbH — built in the open, verified in CI.",
})
