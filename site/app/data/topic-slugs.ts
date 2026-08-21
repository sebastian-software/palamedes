export const TOPIC_SLUGS = [
  "react-server-components-i18n",
  "i18n-performance",
  "icu-messageformat",
  "locale-routing",
] as const

export type TopicSlug = (typeof TOPIC_SLUGS)[number]
