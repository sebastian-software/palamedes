import tailwindcss from "@tailwindcss/vite"
import { ardo } from "ardo/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    tailwindcss(),
    ardo({
      title: "Palamedes",
      description:
        "Rust-powered i18n tooling for JavaScript and TypeScript with source-string-first catalogs.",
      siteUrl: "https://palamedes.dev",
      githubPages: false,
      icons: false,
      sidebar: {
        sectionOrder: ["docs", "api-reference", "decisions", "blog"],
      },
      seo: {
        sitemap: { changefreq: "weekly", priority: 0.7 },
        robots: { allow: ["/"] },
      },
      linkCheck: {
        enabled: true,
        level: "error",
        checkAnchors: false,
        exclude: [
          "/llms.txt",
          "/llms-full.txt",
          "/favicon.svg",
          "/docs/example-screenshots/*",
          "/docs/site/assets/*",
        ],
      },
      metadata: {
        ogType: "website",
        twitterCard: "summary",
      },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
})
