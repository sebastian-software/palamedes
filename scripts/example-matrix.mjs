import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

export const EXAMPLE_MATRIX = [
  {
    id: "nextjs-cookie",
    framework: "nextjs",
    strategy: "cookie",
    port: 4010,
    cwd: path.join(ROOT, "examples/nextjs-cookie"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        substrings: ["accept-language", "Willkommen bei Palamedes"],
      },
    ],
  },
  {
    id: "nextjs-route",
    framework: "nextjs",
    strategy: "route",
    port: 4011,
    cwd: path.join(ROOT, "examples/nextjs-route"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        substrings: ["Locale suggestion", "Switch to the recommended locale"],
      },
      {
        headers: { host: "de.lvh.me:4011" },
        path: "/en",
        substrings: ["This host is mapped to Deutsch"],
      },
    ],
  },
  {
    id: "tanstack-cookie",
    framework: "tanstack",
    strategy: "cookie",
    port: 4020,
    cwd: path.join(ROOT, "examples/tanstack-cookie"),
    build: ["build"],
    start: ["preview"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        substrings: ["Aktuelle Sprache:", "Deutsch", "accept-language"],
      },
    ],
  },
  {
    id: "tanstack-route",
    framework: "tanstack",
    strategy: "route",
    port: 4021,
    cwd: path.join(ROOT, "examples/tanstack-route"),
    build: ["build"],
    start: ["preview"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        substrings: [
          "Locale suggestion",
          "Your browser prefers Deutsch",
          "Switch to the recommended locale",
        ],
      },
      {
        headers: { host: "de.lvh.me:4021" },
        path: "/en",
        substrings: [
          "Locale suggestion",
          "This host is mapped to Deutsch",
          "Switch to the recommended locale",
        ],
      },
    ],
  },
  {
    id: "waku-cookie",
    framework: "waku",
    strategy: "cookie",
    port: 4030,
    cwd: path.join(ROOT, "examples/waku-cookie"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        substrings: ["Current locale", "Deutsch"],
      },
    ],
  },
  {
    id: "waku-route",
    framework: "waku",
    strategy: "route",
    port: 4031,
    cwd: path.join(ROOT, "examples/waku-route"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        substrings: ["Locale suggestion", "Switch to the recommended locale"],
      },
      {
        headers: { host: "de.lvh.me:4031" },
        path: "/en",
        substrings: ["This host is mapped to Deutsch"],
      },
    ],
  },
  {
    id: "react-router-cookie",
    framework: "react-router",
    strategy: "cookie",
    port: 4040,
    cwd: path.join(ROOT, "examples/react-router-cookie"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        substrings: ["accept-language", "This panel was rendered on the server for locale Deutsch."],
      },
    ],
  },
  {
    id: "react-router-route",
    framework: "react-router",
    strategy: "route",
    port: 4041,
    cwd: path.join(ROOT, "examples/react-router-route"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        substrings: ["Locale suggestion", "Switch to the recommended locale"],
      },
      {
        headers: { host: "de.lvh.me:4041" },
        path: "/en",
        substrings: ["This host is mapped to Deutsch"],
      },
    ],
  },
]

export function parseExampleArgs(argv) {
  const filters = {}
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--framework") {
      filters.framework = argv[index + 1]
      index += 1
      continue
    }
    if (value === "--strategy") {
      filters.strategy = argv[index + 1]
      index += 1
    }
  }
  return filters
}

export function selectExamples(filters) {
  return EXAMPLE_MATRIX.filter((example) => {
    if (filters.framework && example.framework !== filters.framework) {
      return false
    }
    if (filters.strategy && example.strategy !== filters.strategy) {
      return false
    }
    return true
  })
}
