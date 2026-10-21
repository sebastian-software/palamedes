import path from "node:path";
import { fileURLToPath } from "node:url";
import { addPlugin, addVitePlugin, createResolver, defineNuxtModule } from "@nuxt/kit";
import { loadPalamedesConfigSync } from "@palamedes/config";
import { palamedes } from "@palamedes/vite-plugin";
import { createViteCatalogDelivery } from "@palamedes/vite-plugin/delivery";

export default defineNuxtModule({
  meta: { name: "palamedes-nuxt-proof" },
  setup(_options, nuxt) {
    const resolver = createResolver(import.meta.url);
    nuxt.options.build.transpile.push(/^@palamedes\/(?:core|runtime)(?:\/|$)/u);
    addVitePlugin(() => ({
      name: "palamedes:nuxt-server-catalog-owner",
      enforce: "pre",
      resolveId(id, _importer, options) {
        if (
          !nuxt.options.dev &&
          id === "virtual:palamedes/server-catalogs" &&
          (options?.ssr || this.environment?.name === "ssr")
        ) {
          // Nitro owns one catalog store shared by page rendering and API handlers.
          return { id, external: true };
        }
      },
    }));
    const compiler = () =>
      palamedes({ cwd: nuxt.options.rootDir, framework: "none", mdx: false, failOnMissing: true });
    addVitePlugin(compiler);
    // This root-mounted proof uses absolute catalog URLs instead of Nuxt's relative Vite base.
    addVitePlugin(() => ({
      name: "palamedes:nuxt-proof-base",
      enforce: "post",
      config: () => (nuxt.options.dev ? undefined : { base: "/" }),
    }));
    addPlugin({ src: resolver.resolve("./runtime/server.ts"), mode: "server", order: -25 });
    addPlugin({ src: resolver.resolve("./runtime/client.ts"), mode: "client", order: -25 });
    nuxt.hook("nitro:config", (config) => {
      config.publicAssets ||= [];
      if (!nuxt.options.dev)
        config.publicAssets.push({
          dir: path.join(nuxt.options.buildDir, "dist/client/assets"),
          baseURL: "/assets",
          maxAge: 31_536_000,
        });
      config.plugins ||= [];
      config.plugins.push(resolver.resolve("./runtime/nitro.ts"));
      config.rollupConfig ||= {};
      config.rollupConfig.plugins ||= [];
      config.rollupConfig.plugins.push(
        ...palamedes({
          cwd: nuxt.options.rootDir,
          framework: "none",
          mdx: false,
          failOnMissing: true,
          environment: "server",
        }),
      );
      config.externals ||= {};
      config.externals.inline ||= [];
      config.externals.inline.push(/^@palamedes\/(?:core|runtime)(?:\/|$)/u);
      for (const name of ["@palamedes/core", "@palamedes/runtime"]) {
        config.externals.inline.push(path.dirname(fileURLToPath(import.meta.resolve(name))));
      }
      config.virtual ||= {};
      config.virtual["#palamedes/catalog-bindings"] = () => {
        if (nuxt.options.dev) return "export default null;";
        const delivery = createViteCatalogDelivery({
          clientDirectory: path.join(nuxt.options.buildDir, "dist/client"),
        });
        const { locales } = loadPalamedesConfigSync({ cwd: nuxt.options.rootDir });
        return `export default ${JSON.stringify(Object.fromEntries(locales.map((locale) => [locale, delivery.getLocaleBinding(locale)])))};`;
      };
    });
  },
});
