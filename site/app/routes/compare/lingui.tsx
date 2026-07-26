import { RivalPage } from "~/components/compare/RivalPage"
import { pageMeta } from "~/lib/meta"
import { rivalBySlug } from "~/data/rivals"

const rival = rivalBySlug("lingui")

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: rival.metaTitle,
    description: rival.metaDescription,
    path: "/compare/lingui",
  })
}

export default function CompareLingui() {
  return <RivalPage rival={rival} />
}
