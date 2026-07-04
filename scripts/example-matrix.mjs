import path from "node:path"
import { fileURLToPath } from "node:url"

export const ROOT = path.resolve(import.meta.dirname, "..")

export const EXAMPLE_MATRIX = [
  {
    id: "nextjs-cookie",
    framework: "nextjs",
    strategy: "cookie",
    port: 4010,
    deployable: false,
    vercelProject: "palamedes-nextjs-cookie",
    publicHost: "palamedes-nextjs-cookie.vercel.app",
    cwd: path.join(ROOT, "examples/nextjs-cookie"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        substrings: ["Deutsch", "Plätze frei"],
      },
    ],
  },
  {
    id: "nextjs-route",
    framework: "nextjs",
    strategy: "route",
    port: 4011,
    deployable: false,
    vercelProject: "palamedes-nextjs-route",
    publicHost: "palamedes-nextjs-route.vercel.app",
    cwd: path.join(ROOT, "examples/nextjs-route"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
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
    deployable: true,
    vercelProject: "palamedes-tanstack-cookie",
    publicHost: "palamedes-tanstack-cookie.vercel.app",
    cwd: path.join(ROOT, "examples/tanstack-cookie"),
    build: ["build"],
    start: ["preview"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        substrings: ["Deutsch", "Plätze frei"],
      },
    ],
  },
  {
    id: "tanstack-route",
    framework: "tanstack",
    strategy: "route",
    port: 4021,
    deployable: true,
    vercelProject: "palamedes-tanstack-route",
    publicHost: "palamedes-tanstack-route.vercel.app",
    cwd: path.join(ROOT, "examples/tanstack-route"),
    build: ["build"],
    start: ["preview"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
      {
        headers: { host: "de.lvh.me:4021" },
        path: "/en",
        substrings: ["This host is mapped to Deutsch"],
      },
    ],
  },
  {
    id: "waku-cookie",
    framework: "waku",
    strategy: "cookie",
    port: 4030,
    deployable: true,
    vercelProject: "palamedes-waku-cookie",
    publicHost: "palamedes-waku-cookie.vercel.app",
    cwd: path.join(ROOT, "examples/waku-cookie"),
    build: ["build"],
    start: ["start"],
    // Waku (Vite RSC) ships a client-bootstrap shell over plain HTTP and streams
    // the rendered markup via the RSC payload, so localized text never appears in
    // the initial document. Node fetch+substring cannot see it; the browser tests
    // (which deserialize the stream) cover this example instead. We still start the
    // server here to confirm it boots and serves.
    smokeChecks: [],
  },
  {
    id: "waku-route",
    framework: "waku",
    strategy: "route",
    port: 4031,
    deployable: true,
    vercelProject: "palamedes-waku-route",
    publicHost: "palamedes-waku-route.vercel.app",
    cwd: path.join(ROOT, "examples/waku-route"),
    build: ["build"],
    start: ["start"],
    // See waku-cookie: the RSC shell hides localized text from a plain fetch, so
    // the Node smoke only confirms boot; browser tests cover the rendered output.
    smokeChecks: [],
  },
  {
    id: "react-router-cookie",
    framework: "react-router",
    strategy: "cookie",
    port: 4040,
    deployable: true,
    vercelProject: "palamedes-reactrouter-cookie",
    publicHost: "palamedes-reactrouter-cookie.vercel.app",
    cwd: path.join(ROOT, "examples/react-router-cookie"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        substrings: ["Deutsch", "Plätze frei"],
      },
    ],
  },
  {
    id: "react-router-route",
    framework: "react-router",
    strategy: "route",
    port: 4041,
    deployable: true,
    vercelProject: "palamedes-reactrouter-route",
    publicHost: "palamedes-reactrouter-route.vercel.app",
    cwd: path.join(ROOT, "examples/react-router-route"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
      {
        headers: { host: "de.lvh.me:4041" },
        path: "/en",
        substrings: ["This host is mapped to Deutsch"],
      },
    ],
  },
  {
    id: "solidstart-cookie",
    framework: "solidstart",
    strategy: "cookie",
    port: 4050,
    deployable: false,
    vercelProject: "",
    publicHost: "",
    cwd: path.join(ROOT, "examples/solidstart-cookie"),
    build: ["build"],
    start: ["start"],
    startEnv: {
      HOST: "127.0.0.1",
      PORT: "4050",
    },
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/",
        substrings: ["Deutsch", "Plätze frei"],
      },
    ],
  },
  {
    id: "solidstart-route",
    framework: "solidstart",
    strategy: "route",
    port: 4051,
    deployable: false,
    vercelProject: "",
    publicHost: "",
    cwd: path.join(ROOT, "examples/solidstart-route"),
    build: ["build"],
    start: ["start"],
    startEnv: {
      HOST: "127.0.0.1",
      PORT: "4051",
    },
    smokeChecks: [
      {
        headers: { "accept-language": "de" },
        path: "/en",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
      {
        headers: { host: "de.lvh.me:4051" },
        path: "/en",
        substrings: ["This host is mapped to Deutsch"],
      },
    ],
  },
  {
    id: "nextjs-subdomain",
    framework: "nextjs",
    strategy: "subdomain",
    port: 4012,
    deployable: false,
    vercelProject: "palamedes-nextjs-subdomain",
    publicHost: "palamedes-nextjs-subdomain.vercel.app",
    cwd: path.join(ROOT, "examples/nextjs-subdomain"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { host: "de.lvh.me:4012" },
        path: "/",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "en.lvh.me:4012", "accept-language": "de" },
        path: "/",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
    ],
  },
  {
    id: "tanstack-subdomain",
    framework: "tanstack",
    strategy: "subdomain",
    port: 4022,
    deployable: true,
    vercelProject: "palamedes-tanstack-subdomain",
    publicHost: "palamedes-tanstack-subdomain.vercel.app",
    cwd: path.join(ROOT, "examples/tanstack-subdomain"),
    build: ["build"],
    start: ["preview"],
    smokeChecks: [
      {
        headers: { host: "de.lvh.me:4022" },
        path: "/",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "en.lvh.me:4022", "accept-language": "de" },
        path: "/",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
    ],
  },
  {
    id: "waku-subdomain",
    framework: "waku",
    strategy: "subdomain",
    port: 4032,
    deployable: true,
    vercelProject: "palamedes-waku-subdomain",
    publicHost: "palamedes-waku-subdomain.vercel.app",
    cwd: path.join(ROOT, "examples/waku-subdomain"),
    build: ["build"],
    start: ["start"],
    // See waku-cookie/route: the RSC shell hides localized text from a plain
    // fetch, so the Node smoke only confirms boot; browser tests cover output.
    smokeChecks: [],
  },
  {
    id: "react-router-subdomain",
    framework: "react-router",
    strategy: "subdomain",
    port: 4042,
    deployable: true,
    vercelProject: "palamedes-reactrouter-subdomain",
    publicHost: "palamedes-reactrouter-subdomain.vercel.app",
    cwd: path.join(ROOT, "examples/react-router-subdomain"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { host: "de.lvh.me:4042" },
        path: "/",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "en.lvh.me:4042", "accept-language": "de" },
        path: "/",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
    ],
  },
  {
    id: "solidstart-subdomain",
    framework: "solidstart",
    strategy: "subdomain",
    port: 4052,
    deployable: false,
    vercelProject: "",
    publicHost: "",
    cwd: path.join(ROOT, "examples/solidstart-subdomain"),
    build: ["build"],
    start: ["start"],
    startEnv: {
      HOST: "127.0.0.1",
      PORT: "4052",
    },
    smokeChecks: [
      {
        headers: { host: "de.lvh.me:4052" },
        path: "/",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "en.lvh.me:4052", "accept-language": "de" },
        path: "/",
        substrings: ["currently rendering", "Switch to the recommended locale"],
      },
    ],
  },
  {
    id: "nextjs-tld",
    framework: "nextjs",
    strategy: "tld",
    port: 4013,
    deployable: false,
    vercelProject: "palamedes-nextjs-tld",
    publicHost: "palamedes-nextjs-tld.vercel.app",
    cwd: path.join(ROOT, "examples/nextjs-tld"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { host: "palamedes-i18n.de:4013" },
        path: "/",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "palamedes-i18n.fr:4013" },
        path: "/",
        substrings: ["français", "places restantes"],
      },
      {
        // `.com` maps to `en` (explicit tld override), so it is authoritative and
        // wins over the browser preference (Accept-Language `de`).
        headers: { host: "palamedes-i18n.com:4013", "accept-language": "de" },
        path: "/",
        substrings: ["English", "seats left"],
      },
    ],
  },
  {
    id: "tanstack-tld",
    framework: "tanstack",
    strategy: "tld",
    port: 4023,
    deployable: true,
    vercelProject: "palamedes-tanstack-tld",
    publicHost: "palamedes-tanstack-tld.vercel.app",
    cwd: path.join(ROOT, "examples/tanstack-tld"),
    build: ["build"],
    start: ["preview"],
    smokeChecks: [
      {
        headers: { host: "palamedes-i18n.de:4023" },
        path: "/",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "palamedes-i18n.fr:4023" },
        path: "/",
        substrings: ["français", "places restantes"],
      },
      {
        // `.com` maps to `en` (explicit tld override), so it is authoritative and
        // wins over the browser preference (Accept-Language `de`).
        headers: { host: "palamedes-i18n.com:4023", "accept-language": "de" },
        path: "/",
        substrings: ["English", "seats left"],
      },
    ],
  },
  {
    id: "waku-tld",
    framework: "waku",
    strategy: "tld",
    port: 4033,
    deployable: true,
    vercelProject: "palamedes-waku-tld",
    publicHost: "palamedes-waku-tld.vercel.app",
    cwd: path.join(ROOT, "examples/waku-tld"),
    build: ["build"],
    start: ["start"],
    // See waku-cookie/route/subdomain: the RSC shell hides localized text from a
    // plain fetch, so the Node smoke only confirms boot; browser tests cover output.
    smokeChecks: [],
  },
  {
    id: "react-router-tld",
    framework: "react-router",
    strategy: "tld",
    port: 4043,
    deployable: true,
    vercelProject: "palamedes-reactrouter-tld",
    publicHost: "palamedes-reactrouter-tld.vercel.app",
    cwd: path.join(ROOT, "examples/react-router-tld"),
    build: ["build"],
    start: ["start"],
    smokeChecks: [
      {
        headers: { host: "palamedes-i18n.de:4043" },
        path: "/",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "palamedes-i18n.fr:4043" },
        path: "/",
        substrings: ["français", "places restantes"],
      },
      {
        // `.com` maps to `en` (explicit tld override), so it is authoritative and
        // wins over the browser preference (Accept-Language `de`).
        headers: { host: "palamedes-i18n.com:4043", "accept-language": "de" },
        path: "/",
        substrings: ["English", "seats left"],
      },
    ],
  },
  {
    id: "solidstart-tld",
    framework: "solidstart",
    strategy: "tld",
    port: 4053,
    deployable: false,
    vercelProject: "",
    publicHost: "",
    cwd: path.join(ROOT, "examples/solidstart-tld"),
    build: ["build"],
    start: ["start"],
    startEnv: {
      HOST: "127.0.0.1",
      PORT: "4053",
    },
    smokeChecks: [
      {
        headers: { host: "palamedes-i18n.de:4053" },
        path: "/",
        substrings: ["Deutsch", "Plätze frei"],
      },
      {
        headers: { host: "palamedes-i18n.fr:4053" },
        path: "/",
        substrings: ["français", "places restantes"],
      },
      {
        // `.com` maps to `en` (explicit tld override), so it is authoritative and
        // wins over the browser preference (Accept-Language `de`).
        headers: { host: "palamedes-i18n.com:4053", "accept-language": "de" },
        path: "/",
        substrings: ["English", "seats left"],
      },
    ],
  },
]

export function parseExampleArgs(argv) {
  const filters = {}
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--id") {
      filters.id = argv[index + 1]
      index += 1
      continue
    }
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
    if (filters.id && example.id !== filters.id) {
      return false
    }
    if (filters.framework && example.framework !== filters.framework) {
      return false
    }
    if (filters.strategy && example.strategy !== filters.strategy) {
      return false
    }
    return true
  })
}
