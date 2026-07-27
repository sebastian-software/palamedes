import { TopicPage } from "~/components/topic/TopicPage"
import { topicMeta } from "~/lib/meta"
import { topicBySlug } from "~/data/topics"

const topic = topicBySlug("icu-messageformat")

export const handle = { layout: "bare" }

export function meta() {
  return topicMeta({
    title: topic.metaTitle,
    description: topic.metaDescription,
    path: "/icu-messageformat",
    faq: topic.faq,
    slug: topic.slug,
  })
}

export default function TopicIcuMessageformat() {
  return <TopicPage topic={topic} />
}
