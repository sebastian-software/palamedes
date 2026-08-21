import { RivalPage } from "~/components/compare/RivalPage"
import { pageMeta } from "~/lib/meta"
import { rivalBySlug } from "~/data/rivals"

const rival = rivalBySlug("i18next")

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: rival.metaTitle,
    description: rival.metaDescription,
    path: "/compare/i18next",
    faq: rival.faq,
  })
}

export default function CompareI18next() {
  return <RivalPage rival={rival} />
}
