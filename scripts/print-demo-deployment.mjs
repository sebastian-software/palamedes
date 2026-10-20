import { DEMO_DEPLOYMENT } from "./demo-deployment.mjs";
console.log(
  JSON.stringify(
    {
      app: "palamedes-demos",
      region: "Frankfurt",
      replicas: { min: 1, max: 1 },
      health: { port: 4080, path: "/ready", publicEndpoint: false },
      endpoints: DEMO_DEPLOYMENT,
    },
    null,
    2,
  ),
);
