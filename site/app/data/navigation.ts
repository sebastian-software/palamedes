export const GUIDE_TOPIC_PATHS = [
  "/react-server-components-i18n",
  "/i18n-performance",
  "/icu-messageformat",
  "/locale-routing",
] as const

export interface PrimaryNavigationLink {
  label: string
  href: string
  relatedPaths?: readonly string[]
}

export interface PrimaryNavigationGroup {
  label: string
  links: readonly PrimaryNavigationLink[]
}

/*
 * Keep the first navigation level small and task-oriented. Evaluation paths
 * answer whether Palamedes fits; resource paths help readers implement it.
 * The guide hub owns the four search-intent topic pages, so those routes keep
 * Guides marked as the current location without becoming more top-level links.
 */
export const PRIMARY_NAVIGATION_GROUPS = [
  {
    label: "Evaluate",
    links: [
      { label: "Frameworks", href: "/frameworks" },
      { label: "Architecture", href: "/architecture" },
    ],
  },
  {
    label: "Resources",
    links: [
      { label: "Guides", href: "/guides", relatedPaths: GUIDE_TOPIC_PATHS },
      { label: "Docs", href: "/docs" },
    ],
  },
] as const satisfies readonly PrimaryNavigationGroup[]

export const PRIMARY_NAVIGATION_LINKS: readonly PrimaryNavigationLink[] = (
  PRIMARY_NAVIGATION_GROUPS as readonly PrimaryNavigationGroup[]
).flatMap((group) => group.links)

export function isPrimaryNavigationLinkActive(
  link: PrimaryNavigationLink,
  pathname: string
): boolean {
  const normalizedPathname = pathname === "/" ? pathname : pathname.replace(/\/+$/, "")

  return (
    normalizedPathname === link.href ||
    normalizedPathname.startsWith(`${link.href}/`) ||
    link.relatedPaths?.includes(normalizedPathname) === true
  )
}
