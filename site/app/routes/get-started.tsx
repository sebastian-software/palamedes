import { ButtonLink, EditorialRail, Page, Section } from "@palamedes/site-ui";
import { PageHero } from "~/components/marketing/PageHero";
import { PlainWords } from "~/components/marketing/PlainWords";
import { V2ReleaseNotice } from "~/components/V2ReleaseNotice";
import { pageMeta } from "~/lib/meta";
import { PipelineDiagram } from "~/components/get-started/PipelineDiagram";
import { StackPicker } from "~/components/get-started/StackPicker";
import { CtaBand } from "~/components/home/CtaBand";
import { FeatureGrid } from "~/components/home/FeatureGrid";
import { NEXT_STEP_CARDS } from "~/data/features";
import { frameworkLandingHref } from "~/data/framework-landing";
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

const OTHER_FRAMEWORKS = [
  { label: "TanStack Start", href: frameworkLandingHref("tanstack") },
  { label: "React Router", href: frameworkLandingHref("react-router") },
  { label: "Waku", href: frameworkLandingHref("waku") },
  { label: "Remix v3", href: frameworkLandingHref("remix") },
] as const;

const WORDS = [
  {
    question: "Macro",
    answer:
      "<Trans> and <Plural> look like components but are rewritten during the build into fast lookups. You write readable JSX; the browser gets optimized code.",
  },
  {
    question: "Extraction",
    answer:
      "pmds extract scans your source and writes every message into one catalog per language — nobody copies text by hand.",
  },
  {
    question: "Catalog (.po)",
    answer:
      "A plain text file per language: the original sentence, its translation, and where it came from. It lives in your repository.",
  },
  {
    question: "Compile",
    answer:
      "The build turns each translation into ready-to-run JavaScript, so the browser never parses message syntax — and broken messages fail early.",
  },
] as const;

const OUTCOMES = [
  "The CLI and your framework adapter installed",
  "One palamedes.yaml that names your languages",
  "A message extracted into an English and a German catalog",
  "The German sentence rendering in your running app",
] as const;

export default function GetStarted() {
  return (
    <Page>
      <PageHero
        kicker="Get started"
        title="Your first working translation."
        lede="Pick your framework, write one sentence, and watch it render in a second language. Follow the steps yourself — or hand them to your coding agent with the Palamedes setup skill."
        actions={
          <>
            <ButtonLink href="#install">Choose your framework</ButtonLink>
            <ButtonLink variant="outline" href={docsHref("agent-skill")}>
              Set up with your agent
            </ButtonLink>
          </>
        }
        aside={
          <div className="border border-ink bg-paper px-7 py-7">
            <p className="micro text-[11px] tracking-label text-accent">
              What you will have at the end
            </p>
            <ul className="mt-5 space-y-4">
              {OUTCOMES.map((outcome) => (
                <li key={outcome} className="flex gap-3 text-[16px] leading-snug">
                  <span aria-hidden className="mt-2 size-1.5 shrink-0 rotate-45 bg-accent" />
                  {outcome}
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-hair pt-4 text-[14px] leading-relaxed text-ink/75">
              The same loop then carries every message your application adds.
            </p>
          </div>
        }
      >
        <V2ReleaseNotice className="mt-7 max-w-[40rem]" />
      </PageHero>

      <Section
        num="01 — The loop"
        title="Four steps you will keep using."
        lede="Write a message, extract it, translate it, render it. The first translation follows the same loop as every one after it — so learning it once is enough."
        id="loop"
      >
        <PipelineDiagram />
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {WORDS.map((word) => (
            <PlainWords key={word.question} question={word.question} answer={word.answer} />
          ))}
        </div>
      </Section>

      <Section
        num="02 — Choose a host"
        title="Pick your stack. Follow seven short steps."
        lede="Each path goes from installation to a rendered translation. Your application keeps deciding which language a visitor gets; the adapter delivers the compiled messages for it."
        id="install"
      >
        <StackPicker />
        <p className="mt-6 max-w-[48rem] text-[16px] leading-relaxed text-ink/80">
          Using another framework? TanStack Start, React Router, Waku, and Remix v3 each have their
          own setup page:{" "}
          {OTHER_FRAMEWORKS.map((framework, index) => (
            <span key={framework.href}>
              <a href={framework.href} className="text-accent underline underline-offset-4">
                {framework.label}
              </a>
              {index < OTHER_FRAMEWORKS.length - 1 ? ", " : "."}
            </span>
          ))}
        </p>
        <EditorialRail className="mt-8">
          <h3 className="text-[15px] font-bold">Prefer to work with your coding agent?</h3>
          <p className="mt-2 max-w-[48em] text-[15.5px] leading-relaxed">
            The Palamedes skill covers Next.js App Router and Vite/React, including migration from
            Lingui. It checks the target version, preserves your translations and locale policy, and
            verifies a working result in both languages.
          </p>
          <ButtonLink variant="small" className="mt-4" href={docsHref("agent-skill")}>
            Install and use the skill
          </ButtonLink>
        </EditorialRail>
      </Section>

      <Section
        num="03 — Next"
        title="Where to go after the first sentence."
        lede="Plurals and dates, a URL strategy, backend messages, a migration, or help when something breaks — pick what your application needs next."
      >
        <FeatureGrid cards={NEXT_STEP_CARDS} />
      </Section>

      <CtaBand
        headline="Ready for production? Choose its shape."
        lede="Pick the framework integration and the way languages appear in your URLs. Each combination already runs as a checked example app."
        primary={{ label: "Choose your framework", href: "/frameworks" }}
        secondary={{ label: "Explore locale architecture", href: "/locale-routing" }}
      />
    </Page>
  );
}
