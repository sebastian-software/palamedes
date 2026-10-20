import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // The public HTTPS origin differs from the HTTP request behind the CDN.
  allowedActionOrigins: ["react-router-route.examples.palamedes.dev"],
} satisfies Config;
