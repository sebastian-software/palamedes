import { RivalPage } from "~/components/compare/RivalPage"
import { pageMeta } from "~/lib/meta"
import { rivalBySlug } from "~/data/rivals"

const rival = rivalBySlug("fbtee")

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: rival.metaTitle,
    description: rival.metaDescription,
    path: "/compare/fbtee",
  })
}

export default function CompareFbtee() {
  return <RivalPage rival={rival} />
}
