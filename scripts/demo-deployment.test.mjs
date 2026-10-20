import { expect, it } from "vitest";
import { DEMO_DEPLOYMENT, selectDeployment } from "./demo-deployment.mjs";
import { EXAMPLE_MATRIX } from "./example-matrix.mjs";
it("routes all 25 demos to distinct ports and all 55 final HTTPS hosts", () => {
  expect(DEMO_DEPLOYMENT.map(({ id, port }) => ({ id, port }))).toEqual(
    EXAMPLE_MATRIX.map(({ id, port }) => ({ id, port })),
  );
  expect(new Set(DEMO_DEPLOYMENT.map(({ port }) => port)).size).toBe(25);
  const hosts = DEMO_DEPLOYMENT.flatMap(({ hosts }) => hosts);
  expect(hosts).toHaveLength(55);
  expect(new Set(hosts).size).toBe(55);
  expect(DEMO_DEPLOYMENT.find(({ id }) => id === "remix-tld").hosts).toEqual(
    ["com", "de", "es", "fr"].map((tld) => `remix.examples.palamedes-i18n.${tld}`),
  );
  expect(selectDeployment(["vite-mdx"])[0].origin).toBe("https://vite-mdx.examples.palamedes.dev");
});
it("rejects unknown, empty, or repeated selections before verification", () => {
  for (const ids of [[], ["unknown"], ["remix-cookie", "remix-cookie"]])
    expect(() => selectDeployment(ids)).toThrow();
  expect(selectDeployment()).toHaveLength(25);
});
