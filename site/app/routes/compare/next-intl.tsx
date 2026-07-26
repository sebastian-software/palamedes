import { RivalPage } from "~/components/compare/RivalPage"
import { pageMeta } from "~/lib/meta"
import { rivalBySlug } from "~/data/rivals"

const rival = rivalBySlug("next-intl")

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: rival.metaTitle,
    description: rival.metaDescription,
    path: "/compare/next-intl",
  })
}

export default function CompareNextIntl() {
  return <RivalPage rival={rival} />
}
