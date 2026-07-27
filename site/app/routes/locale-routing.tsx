import { TopicPage } from "~/components/topic/TopicPage"
import { topicMeta } from "~/lib/meta"
import { topicBySlug } from "~/data/topics"

const topic = topicBySlug("locale-routing")

export const handle = { layout: "bare" }

export function meta() {
  return topicMeta({
    title: topic.metaTitle,
    description: topic.metaDescription,
    path: "/locale-routing",
    faq: topic.faq,
  })
}

export default function TopicLocaleRouting() {
  return <TopicPage topic={topic} />
}
