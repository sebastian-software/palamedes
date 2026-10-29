import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { ardo, defineConfig } from "ardo/vite";

function gitHash(): string {
  const githubSha = process.env.GITHUB_SHA?.trim();
  if (githubSha && /^[0-9a-f]{8,40}$/iu.test(githubSha)) {
    return githubSha.slice(0, 8).toLowerCase();
  }

  try {
    return execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .slice(0, 8)
      .toLowerCase();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  cacheDir: resolve(import.meta.dirname, ".ardo-cache"),
  define: {
    __PALAMEDES_BUILD_HASH__: JSON.stringify(gitHash()),
  },
  optimizeDeps: {
    // Keep application dependencies warm; Ardo manages its own runtime entries.
    include: ["@base-ui/react/tabs", "ferramenta-family/registry"],
  },
  plugins: [
    tailwindcss(),
    ardo({
      title: "Palamedes",
      description: "Rust-powered i18n tooling for TypeScript with source-string-first catalogs.",
      siteUrl: "https://palamedes.dev",
      icons: false,
      sidebar: {
        sectionOrder: ["docs", "api-reference", "decisions", "blog"],
      },
      seo: {
        // The repository maintains curated assistant context files.
        llms: false,
        sitemap: { changefreq: "weekly", priority: 0.7 },
        robots: { allow: ["/"] },
      },
      linkCheck: {
        enabled: true,
        level: "error",
        checkAnchors: true,
        exclude: [
          "/llms.txt",
          "/llms-full.txt",
          "/favicon.svg",
          "/docs/example-screenshots/*",
          "/docs/assets/palamedes-localized-matrix.png",
        ],
      },
      metadata: {
        ogType: "website",
        twitterCard: "summary_large_image",
        image: "/og-image.png",
      },
      markdown: {
        toc: { level: [2, 2] },
      },
    }),
  ],
  resolve: {
    alias: { "~": resolve(import.meta.dirname, "app") },
    dedupe: ["react", "react-dom"],
    tsconfigPaths: true,
  },
  server: {
    fs: {
      // pnpm stores these installed CSS packages outside the documentation root.
      allow: [
        import.meta.dirname,
        realpathSync(resolve(import.meta.dirname, "node_modules/@palamedes/site-ui")),
        realpathSync(resolve(import.meta.dirname, "node_modules/tailwindcss")),
      ],
    },
  },
});
