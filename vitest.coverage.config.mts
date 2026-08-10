import { defineConfig } from "vitest/config"

const standardPackages = [
  "config",
  "core-node",
  "core",
  "eslint-plugin",
  "extractor",
  "next-plugin",
  "react-router-rsc",
  "react",
  "remix",
  "runtime",
  "site-ui",
  "tanstack",
  "transform",
  "vite-plugin",
  "waku",
]

export default defineConfig({
  test: {
    projects: [
      ...standardPackages.map((name) => ({
        test: {
          name: `@palamedes/${name}`,
          root: `./packages/${name}`,
          globals: true,
          include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
        },
      })),
      "packages/solid",
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.{js,jsx,ts,tsx}"],
      exclude: ["**/*.test.*", "**/*.d.ts"],
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage/javascript",
      reportOnFailure: true,
    },
  },
})
