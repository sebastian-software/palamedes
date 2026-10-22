import { palamedes } from "@palamedes/vite-plugin";
import type { PluginOption } from "vite";

export function palamedesSvelteKit(): PluginOption {
  return [
    palamedes({ framework: "none", mdx: false, failOnMissing: true }),
    {
      name: "palamedes:sveltekit-proof",
      config: () => ({
        ssr: { noExternal: [/^@palamedes\/(?:core|runtime|example-ui)(?:\/|$)/] },
      }),
    },
  ];
}
