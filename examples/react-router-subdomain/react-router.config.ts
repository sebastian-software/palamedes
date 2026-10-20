import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // The public HTTPS origin differs from the HTTP request behind the CDN.
  allowedActionOrigins: [
    "en.react-router-subdomain.examples.palamedes.dev",
    "de.react-router-subdomain.examples.palamedes.dev",
    "es.react-router-subdomain.examples.palamedes.dev",
    "fr.react-router-subdomain.examples.palamedes.dev",
  ],
} satisfies Config;
