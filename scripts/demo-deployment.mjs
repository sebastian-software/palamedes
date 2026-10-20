import { EXAMPLE_MATRIX } from "./example-matrix.mjs";

// Domain policy lives here; ports and supported identities remain matrix-owned.
export const DEMO_DEPLOYMENT = EXAMPLE_MATRIX.map((example) => {
  const { id, framework, strategy, port } = example;
  const hosts =
    strategy === "tld"
      ? ["com", "de", "es", "fr"].map((tld) => `${framework}.examples.palamedes-i18n.${tld}`)
      : strategy === "subdomain"
        ? ["en", "de", "es", "fr"].map((locale) => `${locale}.${id}.examples.palamedes.dev`)
        : [`${id}.examples.palamedes.dev`];
  return { id, framework, strategy, port, hosts, origin: `https://${hosts[0]}` };
});

export function selectDeployment(ids = DEMO_DEPLOYMENT.map(({ id }) => id)) {
  if (
    !ids.length ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !DEMO_DEPLOYMENT.some((entry) => entry.id === id))
  ) {
    throw new Error("Select distinct example IDs from the deployment manifest.");
  }
  return DEMO_DEPLOYMENT.filter((entry) => ids.includes(entry.id));
}
