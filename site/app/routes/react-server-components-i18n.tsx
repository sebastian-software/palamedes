import { TopicPage } from "~/components/topic/TopicPage"
import { topicMeta } from "~/lib/meta"
import { topicBySlug } from "~/data/topics"

const topic = topicBySlug("react-server-components-i18n")

export const handle = { layout: "bare" }

export function meta() {
  return topicMeta({
    title: topic.metaTitle,
    description: topic.metaDescription,
    path: "/react-server-components-i18n",
    faq: topic.faq,
  })
}

export default function TopicReactServerComponentsI18n() {
  return <TopicPage topic={topic} />
}
