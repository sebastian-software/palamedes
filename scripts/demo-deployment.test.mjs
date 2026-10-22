import { expect, it } from "vitest";
import { DEMO_DEPLOYMENT, selectDeployment } from "./demo-deployment.mjs";
import { EXAMPLE_MATRIX } from "./example-matrix.mjs";
import { COMPONENT_DEMOS, CONTAINER_EXAMPLES } from "./component-demos.mjs";
import { buildStartArgs, buildStartEnv } from "./container/start-plan.mjs";
it("routes all 41 demos to distinct ports and all 101 final HTTPS hosts", () => {
  expect(DEMO_DEPLOYMENT.map(({ id, port }) => ({ id, port }))).toEqual(
    CONTAINER_EXAMPLES.map(({ id, port }) => ({ id, port })),
  );
  expect(new Set(DEMO_DEPLOYMENT.map(({ port }) => port)).size).toBe(41);
  const hosts = DEMO_DEPLOYMENT.flatMap(({ hosts }) => hosts);
  expect(hosts).toHaveLength(101);
  expect(new Set(hosts).size).toBe(101);
  expect(DEMO_DEPLOYMENT.find(({ id }) => id === "remix-tld").hosts).toEqual(
    ["com", "de", "es", "fr"].map((tld) => `remix.examples.palamedes-i18n.${tld}`),
  );
  expect(selectDeployment(["vite-mdx"])[0].origin).toBe("https://vite-mdx.examples.palamedes.dev");
});
it("rejects unknown, empty, or repeated selections before verification", () => {
  for (const ids of [[], ["unknown"], ["remix-cookie", "remix-cookie"]])
    expect(() => selectDeployment(ids)).toThrow();
  expect(selectDeployment()).toHaveLength(41);
});
it("runs four strategies per component framework from one shared build", () => {
  expect(EXAMPLE_MATRIX).toHaveLength(25);
  expect(COMPONENT_DEMOS).toHaveLength(16);
  expect(new Set(COMPONENT_DEMOS.map(({ cwd }) => cwd)).size).toBe(4);
  for (const framework of ["vue", "nuxt", "svelte", "sveltekit"]) {
    expect(
      COMPONENT_DEMOS.filter((demo) => demo.framework === framework).map(
        ({ strategy }) => strategy,
      ),
    ).toEqual(["cookie", "route", "subdomain", "tld"]);
  }
  for (const demo of COMPONENT_DEMOS) {
    const env = buildStartEnv(demo);
    expect(env.HOST).toBe("0.0.0.0");
    expect(env.PORT).toBe(String(demo.port));
    expect(env.PALAMEDES_DEMO_STRATEGY).toBe(demo.strategy);
    if (demo.framework === "nuxt") expect(env.NITRO_HOST).toBe("0.0.0.0");
    if (demo.framework === "sveltekit")
      expect(buildStartArgs(demo)).toEqual(["exec", "node", "build/index.js"]);
    if (demo.rendering === "client")
      expect(buildStartArgs(demo)).toEqual([
        "exec",
        "vite",
        "preview",
        "--host",
        "0.0.0.0",
        "--port",
        String(demo.port),
      ]);
  }
  expect(DEMO_DEPLOYMENT.some(({ port }) => port === 4080)).toBe(false);
});
