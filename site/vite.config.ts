import { resolve } from "node:path"

import tailwindcss from "@tailwindcss/vite"
import { ardo } from "ardo/vite"
import { defineConfig, type Plugin } from "vite"

/*
 * Ardo 4.x injects per-page meta from markdown frontmatter in an
 * enforce:"pre" transform that inspects the RAW markdown for
 * "export const frontmatter" — which only exists after MDX compilation, so
 * the injection never fires and every generated docs/ADR/blog page prerenders
 * without <title>, description, canonical, or OG tags. This plugin runs in
 * the normal transform phase (after MDX compilation) and appends a meta
 * export built from the compiled frontmatter binding. It skips any module
 * that already has a meta export, so it becomes a no-op if Ardo fixes the
 * ordering upstream.
 */
function markdownRouteMeta(): Plugin {
  const routesDir = resolve(import.meta.dirname, "app/routes")
  const metaModule = resolve(import.meta.dirname, "app/lib/meta.ts")
  return {
    name: "palamedes-markdown-route-meta",
    enforce: "post",
    transform(code, id) {
      const [file] = id.split("?", 1)
      if (!/\.(md|mdx)$/u.test(file) || !file.startsWith(routesDir)) return
      if (!code.includes("export const frontmatter")) return
      if (code.includes("export const meta") || code.includes("export function meta")) return
      const route = file
        .slice(routesDir.length)
        .replace(/\.(md|mdx)$/u, "")
        .replace(/\/index$/u, "")
      return {
        code: [
          code,
          `import { pageMeta as __pageMeta } from ${JSON.stringify(metaModule)}`,
          "export const meta = () =>",
          "  frontmatter.title",
          '    ? __pageMeta({ title: `${frontmatter.title} | Palamedes`, description: frontmatter.description ?? "", path: ' +
            `${JSON.stringify(route === "" ? "/" : route)} })`,
          "    : []",
        ].join("\n"),
        map: null,
      }
    },
  }
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    markdownRouteMeta(),
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
        twitterCard: "summary_large_image",
      },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
})
