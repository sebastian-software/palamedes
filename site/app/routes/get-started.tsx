import { ButtonLink, EditorialRail, Page, Section } from "@palamedes/site-ui";
import { V2ReleaseNotice } from "~/components/V2ReleaseNotice";
import { pageMeta } from "~/lib/meta";
import { PipelineDiagram } from "~/components/get-started/PipelineDiagram";
import { StackPicker } from "~/components/get-started/StackPicker";
import { CtaBand } from "~/components/home/CtaBand";
import { FeatureGrid } from "~/components/home/FeatureGrid";
import { NEXT_STEP_CARDS } from "~/data/features";
import { docsHref } from "~/data/links";

export const handle = { layout: "bare" };

export function meta() {
  return pageMeta({
    title: "Get started with Palamedes — your first working translation",
    description:
      "Set up your first translation in Next.js, Vite/React, or Solid. Follow the manual guide or use the repository agent skill for supported setup and Lingui migration.",
    path: "/get-started",
  });
}

export default function GetStarted() {
  return (
    <Page>
      <section className="px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">Quickstart</p>
        <h1 className="mt-6 max-w-[12em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          Your first working translation.
        </h1>
        <p className="mt-6 max-w-[38em]">
          Choose your framework, write a message, and render it in a second language. Follow the
          steps yourself or give the repository's setup skill to your coding agent.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href="#install">Choose your framework</ButtonLink>
          <ButtonLink variant="outline" href={docsHref("agent-skill")}>
            Set up with your agent
          </ButtonLink>
        </div>
        <V2ReleaseNotice className="mt-7 max-w-[44rem]" />
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
        lede="Choose your host, then follow the complete path from installation to a rendered translation. Locale selection stays with your application; the adapter handles compiled catalog delivery."
        id="install"
      >
        <StackPicker />
        <EditorialRail className="mt-8">
          <h3 className="text-[15px] font-bold">Prefer to work with your coding agent?</h3>
          <p className="mt-2 max-w-[48em] text-[13.5px] leading-relaxed">
            The Palamedes skill covers Next.js App Router and Vite/React, including migration from
            Lingui. It checks the target version, preserves your translations and locale policy, and
            verifies a working result in both languages.
          </p>
          <ButtonLink variant="small" className="mt-4" href={docsHref("agent-skill")}>
            Install and use the skill
          </ButtonLink>
        </EditorialRail>
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
  );
}
