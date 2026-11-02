import { describe, expect, test } from "vitest";

import { PRIMARY_NAVIGATION_LINKS } from "./navigation";
import { TOPIC_SLUGS } from "./topic-slugs";

describe("primary site navigation", () => {
  test("keeps four first-level destinations without navigation groups", () => {
    expect(PRIMARY_NAVIGATION_LINKS.map(({ label, href }) => ({ label, href }))).toEqual([
      { label: "Frameworks", href: "/frameworks" },
      { label: "Architecture", href: "/architecture" },
      { label: "Guides", href: "/guides" },
      { label: "Docs", href: "/docs" },
    ]);
  });

  test("matches topic routes through Ardo's native activeMatch option", () => {
    const guides = PRIMARY_NAVIGATION_LINKS.find((link) => link.href === "/guides");
    expect(guides?.activeMatch).toBeDefined();
    const pattern = new RegExp(guides!.activeMatch!, "u");
    for (const slug of TOPIC_SLUGS) {
      expect(pattern.test(`/${slug}`)).toBe(true);
      expect(pattern.test(`/${slug}/`)).toBe(true);
      expect(pattern.test(`/${slug}-extra`)).toBe(false);
    }
    expect(pattern.test("/guidebook")).toBe(false);
  });
});
