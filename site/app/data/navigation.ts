import { TOPIC_SLUGS } from "./topic-slugs";

export interface PrimaryNavigationLink {
  label: string;
  href: string;
  activeMatch?: string;
}

/** Topic pages remain part of the Guides destination. */
export const PRIMARY_NAVIGATION_LINKS: readonly PrimaryNavigationLink[] = [
  { label: "Frameworks", href: "/frameworks" },
  { label: "Architecture", href: "/architecture" },
  { label: "Guides", href: "/guides", activeMatch: `^/(${TOPIC_SLUGS.join("|")})/?$` },
  { label: "Docs", href: "/docs" },
];
