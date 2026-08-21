import { readFileSync } from "node:fs"

import { describe, expect, test } from "vitest"

import {
  GUIDE_TOPIC_PATHS,
  PRIMARY_NAVIGATION_GROUPS,
  PRIMARY_NAVIGATION_LINKS,
  isPrimaryNavigationLinkActive,
} from "./navigation"

describe("primary site navigation", () => {
  test("keeps four first-level destinations split by reader task", () => {
    expect(PRIMARY_NAVIGATION_GROUPS.map((group) => group.label)).toEqual(["Evaluate", "Resources"])
    expect(PRIMARY_NAVIGATION_LINKS).toEqual([
      { label: "Frameworks", href: "/frameworks" },
      { label: "Architecture", href: "/architecture" },
      { label: "Guides", href: "/guides", relatedPaths: GUIDE_TOPIC_PATHS },
      { label: "Docs", href: "/docs" },
    ])
  })

  test("keeps the guide hub current on all four topic routes", () => {
    const topicSource = readFileSync(new URL("topics.ts", import.meta.url), "utf8")
    const topicPaths = [...topicSource.matchAll(/^ {4}slug: "([^"]+)",$/gmu)].map(
      ([, slug]) => `/${slug}`
    )
    const guides = PRIMARY_NAVIGATION_LINKS.find((link) => link.href === "/guides")

    expect(topicPaths).toEqual(GUIDE_TOPIC_PATHS)
    expect(guides).toBeDefined()
    expect(GUIDE_TOPIC_PATHS.every((path) => isPrimaryNavigationLinkActive(guides!, path))).toBe(
      true
    )
    expect(isPrimaryNavigationLinkActive(guides!, "/icu-messageformat/")).toBe(true)
    expect(isPrimaryNavigationLinkActive(guides!, "/guides/elsewhere")).toBe(true)
    expect(isPrimaryNavigationLinkActive(guides!, "/guidebook")).toBe(false)
  })
})
