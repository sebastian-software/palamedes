import type { Config } from "@react-router/dev/config";

export default {
  ssr: true,
  // The public HTTPS origin differs from the HTTP request behind the CDN.
  allowedActionOrigins: [
    "react-router.examples.palamedes-i18n.com",
    "react-router.examples.palamedes-i18n.de",
    "react-router.examples.palamedes-i18n.es",
    "react-router.examples.palamedes-i18n.fr",
  ],
} satisfies Config;
