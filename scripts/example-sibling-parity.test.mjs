import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

import { EXAMPLE_MATRIX } from "./example-matrix.mjs"

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const UI_COMPONENTS = new Set([
  "ClientReady.tsx",
  "ProofPanel.tsx",
  "SuggestionBanner.tsx",
  "TicketPanel.tsx",
])
const UI_FAMILIES = new Set(["nextjs", "react-router", "solid", "tanstack", "waku"])

const sibling = (example, component) =>
  `examples/${example}/${example.startsWith("react-router-") ? "app" : "src"}/components/${component}`

/*
 * These groups deliberately cover only files whose strategy implementation is
 * shared. Every sibling file is either here or in INTENDED_DIVERGENCES below;
 * the coverage assertion prevents a new, unreviewed variation from quietly
 * escaping the byte-parity contract.
 */
const IDENTICAL_SIBLING_GROUPS = [
  [
    "nextjs ClientReady",
    ["nextjs-cookie", "nextjs-route", "nextjs-subdomain", "nextjs-tld"],
    "ClientReady.tsx",
  ],
  [
    "nextjs ProofPanel non-cookie",
    ["nextjs-route", "nextjs-subdomain", "nextjs-tld"],
    "ProofPanel.tsx",
  ],
  [
    "nextjs TicketPanel non-cookie",
    ["nextjs-route", "nextjs-subdomain", "nextjs-tld"],
    "TicketPanel.tsx",
  ],
  [
    "nextjs SuggestionBanner",
    ["nextjs-route", "nextjs-subdomain", "nextjs-tld"],
    "SuggestionBanner.tsx",
  ],
  [
    "tanstack ClientReady non-cookie",
    ["tanstack-route", "tanstack-subdomain", "tanstack-tld"],
    "ClientReady.tsx",
  ],
  [
    "tanstack ProofPanel non-cookie",
    ["tanstack-route", "tanstack-subdomain", "tanstack-tld"],
    "ProofPanel.tsx",
  ],
  [
    "tanstack TicketPanel",
    ["tanstack-cookie", "tanstack-route", "tanstack-subdomain", "tanstack-tld"],
    "TicketPanel.tsx",
  ],
  [
    "tanstack SuggestionBanner",
    ["tanstack-route", "tanstack-subdomain", "tanstack-tld"],
    "SuggestionBanner.tsx",
  ],
  [
    "solid ClientReady non-cookie",
    ["solid-route", "solid-subdomain", "solid-tld"],
    "ClientReady.tsx",
  ],
  ["solid ProofPanel host strategies", ["solid-subdomain", "solid-tld"], "ProofPanel.tsx"],
  [
    "solid TicketPanel non-cookie",
    ["solid-route", "solid-subdomain", "solid-tld"],
    "TicketPanel.tsx",
  ],
  [
    "solid SuggestionBanner host strategies",
    ["solid-subdomain", "solid-tld"],
    "SuggestionBanner.tsx",
  ],
  ["waku ClientReady non-cookie", ["waku-route", "waku-subdomain", "waku-tld"], "ClientReady.tsx"],
  ["waku ProofPanel non-cookie", ["waku-route", "waku-subdomain", "waku-tld"], "ProofPanel.tsx"],
  [
    "waku TicketPanel",
    ["waku-cookie", "waku-route", "waku-subdomain", "waku-tld"],
    "TicketPanel.tsx",
  ],
  ["waku SuggestionBanner", ["waku-route", "waku-subdomain", "waku-tld"], "SuggestionBanner.tsx"],
  [
    "react-router ClientReady",
    ["react-router-cookie", "react-router-route", "react-router-subdomain", "react-router-tld"],
    "ClientReady.tsx",
  ],
  [
    "react-router ProofPanel",
    ["react-router-cookie", "react-router-route", "react-router-subdomain", "react-router-tld"],
    "ProofPanel.tsx",
  ],
  [
    "react-router TicketPanel",
    ["react-router-cookie", "react-router-route", "react-router-subdomain", "react-router-tld"],
    "TicketPanel.tsx",
  ],
  [
    "react-router SuggestionBanner",
    ["react-router-route", "react-router-subdomain", "react-router-tld"],
    "SuggestionBanner.tsx",
  ],
]

/*
 * Keep this list narrow and explanatory. An intentional variation belongs here
 * only when its strategy-specific behavior prevents sharing the sibling file.
 */
const INTENDED_DIVERGENCES = [
  [
    "nextjs-cookie",
    "ProofPanel.tsx",
    "Cookie proof calls its no-argument Server Action; URL strategies pass the active locale.",
  ],
  [
    "nextjs-cookie",
    "TicketPanel.tsx",
    "Cookie retains the authored source-fallback development probe.",
  ],
  [
    "tanstack-cookie",
    "ClientReady.tsx",
    "Cookie verifies its client locale boundary; the URL strategies need only hydration readiness.",
  ],
  [
    "tanstack-cookie",
    "ProofPanel.tsx",
    "Cookie keeps the action proof that exercises its cookie-backed request locale.",
  ],
  [
    "solid-cookie",
    "ClientReady.tsx",
    "Cookie verifies its client locale boundary; the URL strategies need only hydration readiness.",
  ],
  ["solid-cookie", "ProofPanel.tsx", "Cookie passes the negotiated locale to its server function."],
  [
    "solid-route",
    "ProofPanel.tsx",
    "Route derives the locale from the path; host strategies resolve it from the request host.",
  ],
  [
    "solid-cookie",
    "TicketPanel.tsx",
    "Cookie keeps the authored source-fallback development probe.",
  ],
  [
    "solid-route",
    "SuggestionBanner.tsx",
    "Route suggestions can stay on-origin and require the router external-link opt-out.",
  ],
  [
    "waku-cookie",
    "ClientReady.tsx",
    "Cookie verifies its client locale boundary; the URL strategies need only hydration readiness.",
  ],
  [
    "waku-cookie",
    "ProofPanel.tsx",
    "Cookie demonstrates the full Waku Server Action proof surface; URL strategies use the focused probe.",
  ],
]

function declaredSiblingFiles() {
  return new Set([
    ...IDENTICAL_SIBLING_GROUPS.flatMap(([, examples, component]) =>
      examples.map((example) => sibling(example, component))
    ),
    ...INTENDED_DIVERGENCES.map(([example, component]) => sibling(example, component)),
  ])
}

async function actualSiblingFiles() {
  const files = []
  for (const example of EXAMPLE_MATRIX) {
    if (!UI_FAMILIES.has(example.framework)) continue
    const directory = path.join(
      REPOSITORY_ROOT,
      "examples",
      example.id,
      example.framework === "react-router" ? "app" : "src",
      "components"
    )
    for (const filename of await readdir(directory)) {
      if (UI_COMPONENTS.has(filename)) files.push(sibling(example.id, filename))
    }
  }
  return new Set(files)
}

describe("example sibling byte parity", () => {
  it("keeps known-shared UI siblings byte-identical", async () => {
    for (const [name, examples, component] of IDENTICAL_SIBLING_GROUPS) {
      const files = examples.map((example) => sibling(example, component))
      const [reference, ...siblings] = await Promise.all(
        files.map((file) => readFile(path.join(REPOSITORY_ROOT, file), "utf8"))
      )
      for (let index = 0; index < siblings.length; index += 1) {
        expect(siblings[index], `${name}: ${files[index + 1]} drifted from ${files[0]}`).toBe(
          reference
        )
      }
    }
  })

  it("accounts for every UI sibling with parity or an explicit strategy reason", async () => {
    const declared = declaredSiblingFiles()
    const actual = await actualSiblingFiles()

    expect([...declared].sort()).toEqual([...actual].sort())
    expect(INTENDED_DIVERGENCES.every(([_example, _component, reason]) => reason.length > 0)).toBe(
      true
    )
  })

  it("allowlists Remix locale redirects against generated switch targets", async () => {
    for (const strategy of ["route", "subdomain", "tld"]) {
      const directory = path.join(REPOSITORY_ROOT, "examples", `remix-${strategy}`, "app")
      const [controller, i18n] = await Promise.all([
        readFile(path.join(directory, "actions/controller.ts"), "utf8"),
        readFile(path.join(directory, "i18n.ts"), "utf8"),
      ])

      expect(controller).toContain("resolveLocaleRedirect(context.request, locale, redirect,")
      expect(controller).not.toContain('redirect.startsWith("/")')
      expect(i18n).toContain("item.locale === locale")
      expect(i18n).toContain('typeof redirect === "string" && redirect === allowedRedirect')
    }
  })
})
