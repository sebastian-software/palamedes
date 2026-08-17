import { ButtonLink, Page, Section } from "@palamedes/site-ui"
import { pageMeta } from "~/lib/meta"
import { PipelineDiagram } from "~/components/get-started/PipelineDiagram"
import { StackPicker } from "~/components/get-started/StackPicker"
import { CtaBand } from "~/components/home/CtaBand"
import { FeatureGrid } from "~/components/home/FeatureGrid"
import { NEXT_STEP_CARDS } from "~/data/features"
import { docsHref } from "~/data/links"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: "Get started with Palamedes — guided first translation",
    description:
      "Follow the guided first-translation path: install the scoped @palamedes packages, configure palamedes.yaml, extract with pmds, translate the .po catalog, and see it render.",
    path: "/get-started",
  })
}

export default function GetStarted() {
  return (
    <Page>
      <section className="px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">Quickstart</p>
        <h1 className="mt-6 max-w-[12em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          The guided first-translation path.
        </h1>
        <p className="mt-6 max-w-[38em]">
          One translated component, one extraction run, one <code>.po</code> file, one runtime
          instance. It is a compact route through the real moving parts, not a completion-time
          guarantee.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="#loop">See the local loop</ButtonLink>
          <ButtonLink variant="outline" href={docsHref("first-working-translation")}>
            Full written guide
          </ButtonLink>
        </div>
      </section>

      <Section
        num="01 — The loop"
        title="Know the path before touching configuration."
        lede="The guided route follows the same cycle you will keep using after the first translation."
        id="loop"
      >
        <div className="flex justify-end">
          <PipelineDiagram />
        </div>
      </Section>

      <Section
        num="02 — Choose a host"
        title="Run the complete local loop in your stack."
        lede="Choose the nearest host, then work through install, configuration, authoring, extraction, translation, and rendering. The package caveat appears directly after the command it qualifies."
        id="install"
      >
        <StackPicker />
      </Section>

      <Section num="03 — Next" title="Carry the model into the application.">
        <FeatureGrid cards={NEXT_STEP_CARDS} />
      </Section>

      <CtaBand
        headline="Choose the production shape that comes next."
        primary={{ label: "Choose your framework", href: "/frameworks" }}
        secondary={{ label: "Explore locale architecture", href: "/locale-routing" }}
      />
    </Page>
  )
}
