import type { Config } from "@react-router/dev/config"

export default {
  ssr: false,
  prerender: ["/", "/frameworks", "/proof", "/get-started", "/compare", "/blog"],
} satisfies Config
