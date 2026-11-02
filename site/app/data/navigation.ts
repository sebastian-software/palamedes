import { TOPIC_SLUGS, type TopicSlug } from "./topic-slugs";

export const GUIDE_TOPIC_PATHS: readonly `/${TopicSlug}`[] = TOPIC_SLUGS.map(
  (slug): `/${TopicSlug}` => `/${slug}`,
);

export interface PrimaryNavigationLink {
  label: string;
  href: string;
  relatedPaths?: readonly string[];
}

/** Topic pages remain part of the Guides destination. */
export const PRIMARY_NAVIGATION_LINKS: readonly PrimaryNavigationLink[] = [
  { label: "Frameworks", href: "/frameworks" },
  { label: "Architecture", href: "/architecture" },
  { label: "Guides", href: "/guides", relatedPaths: GUIDE_TOPIC_PATHS },
  { label: "Docs", href: "/docs" },
];

export function isPrimaryNavigationLinkActive(
  link: PrimaryNavigationLink,
  pathname: string,
): boolean {
  const normalizedPathname = pathname === "/" ? pathname : pathname.replace(/\/+$/, "");

  return (
    normalizedPathname === link.href ||
    normalizedPathname.startsWith(`${link.href}/`) ||
    link.relatedPaths?.includes(normalizedPathname) === true
  );
}
