import { RivalPage } from "~/components/compare/RivalPage"
import { pageMeta } from "~/lib/meta"
import { rivalBySlug } from "~/data/rivals"

const rival = rivalBySlug("react-intl")

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: rival.metaTitle,
    description: rival.metaDescription,
    path: "/compare/react-intl",
    faq: rival.faq,
  })
}

export default function CompareReactIntl() {
  return <RivalPage rival={rival} />
}
