import { ButtonLink } from "~/components/chrome/Button"
import { Page } from "~/components/chrome/Page"
import { pageMeta } from "~/lib/meta"
import { Section } from "~/components/chrome/Section"
import { PipelineDiagram } from "~/components/get-started/PipelineDiagram"
import { StackPicker } from "~/components/get-started/StackPicker"
import { CtaBand } from "~/components/home/CtaBand"
import { FeatureGrid } from "~/components/home/FeatureGrid"
import { NEXT_STEP_CARDS } from "~/data/features"
import { apiHref, docsHref } from "~/data/links"

export const handle = { layout: "bare" }

export function meta() {
  return pageMeta({
    title: "Get started with Palamedes in 5 minutes",
    description:
      "First working translation in 5 minutes: install the scoped @palamedes packages, configure palamedes.yaml, extract with pmds, translate the .po catalog, and see it render.",
    path: "/get-started",
  })
}

export default function GetStarted() {
  return (
    <Page>
      <section className="px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">Quickstart</p>
        <h1 className="mt-6 max-w-[12em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          First working translation in 5&nbsp;minutes.
        </h1>
        <p className="mt-6 max-w-[38em]">
          One translated component, one extraction run, one <code>.po</code> file, one runtime
          instance. No message IDs to invent, no dictionary files to maintain.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="#install">Skip to step 1</ButtonLink>
          <ButtonLink variant="outline" href={docsHref("first-working-translation")}>
            Full written guide
          </ButtonLink>
        </div>
      </section>

      <Section num="01 — Steps" title="The full local loop." id="install">
        <div className="mb-6 flex justify-end">
          <PipelineDiagram />
        </div>
        <div className="mb-8 max-w-[56em] border-l-4 border-accent pl-4">
          <p className="micro text-[10px] text-gray-spec">Honest note</p>
          <p className="mt-1 text-[13.5px]">
            Install the scoped <code>@palamedes/*</code> packages. The top-level{" "}
            <code>palamedes</code> and <code>create-palamedes</code> names are reserved for a future
            one-command setup and are not the entry point today.
          </p>
        </div>
        <StackPicker />
      </Section>

      <Section num="02 — Next" title="Where to go from here">
        <FeatureGrid cards={NEXT_STEP_CARDS} sectionIndex="02" />
      </Section>

      <CtaBand
        headline="Stuck? The maintainer reads every issue."
        primary={{
          label: "Open an issue",
          href: "https://github.com/sebastian-software/palamedes/issues",
        }}
        secondary={{ label: "Read the docs", href: apiHref() }}
      />
    </Page>
  )
}
