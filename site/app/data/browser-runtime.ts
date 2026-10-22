import report from "./generated/browser-runtime.json";

const integrations: Record<string, { name: string; hosts: string }> = {
  core: { name: "Core", hosts: "Vue · Nuxt · Svelte · SvelteKit · TypeScript" },
  react: { name: "React", hosts: "Next.js · React Router · Waku · TanStack Start · Vite" },
  solid: { name: "Solid", hosts: "SolidStart · TanStack Start · Vite" },
  remix: { name: "Remix", hosts: "Remix 3" },
};

export const browserRuntime = {
  measuredAt: report.measuredAt.slice(0, 10),
  profiles: report.profiles.map((profile) => ({ ...profile, ...integrations[profile.id] })),
  catalog: report.catalog,
};

export function formatRuntimeKB(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} kB`;
}
