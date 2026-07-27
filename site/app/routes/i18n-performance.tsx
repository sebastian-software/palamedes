import { TopicPage } from "~/components/topic/TopicPage"
import { topicMeta } from "~/lib/meta"
import { topicBySlug } from "~/data/topics"

const topic = topicBySlug("i18n-performance")

export const handle = { layout: "bare" }

export function meta() {
  return topicMeta({
    title: topic.metaTitle,
    description: topic.metaDescription,
    path: "/i18n-performance",
    faq: topic.faq,
  })
}

export default function TopicI18nPerformance() {
  return <TopicPage topic={topic} />
}
