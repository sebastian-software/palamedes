import { Page } from "@palamedes/site-ui";
import { BeforeAfter } from "~/components/home/BeforeAfter";
import { Chooser } from "~/components/home/Chooser";
import { CtaBand } from "~/components/home/CtaBand";
import { FrameworkWiring } from "~/components/home/FrameworkWiring";
import { HomeFaq, HOME_FAQ } from "~/components/home/HomeFaq";
import { HomeHero } from "~/components/home/HomeHero";
import { IntegrationBand } from "~/components/home/IntegrationBand";
import { Journey } from "~/components/home/Journey";
import { OriginStory } from "~/components/home/OriginStory";
import { ProofSection } from "~/components/home/ProofSection";
import { QuestionRoutes } from "~/components/home/QuestionRoutes";
import { RustApplications } from "~/components/home/RustApplications";
import { RustRace } from "~/components/home/RustRace";
import { Band, BandHeader } from "~/components/marketing/Band";
import { REPO } from "~/data/links";
import { pageMeta } from "~/lib/meta";

export const handle = { layout: "bare" };

export function meta() {
  const title = "Palamedes — just write the sentence";
  const description =
    "Open-source i18n for React, Solid, and TypeScript: write plain sentences in your components, give translators standard .po files, ship compiled messages per screen, and keep tooling fast with a Rust core. First-party adapters for Next.js, React Router, TanStack Start, Solid, and Vite, with Waku and Remix v3 in preview.";

  return [
    ...pageMeta({ title, description, path: "/" }),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: HOME_FAQ.map((entry) => ({
          "@type": "Question",
          name: entry.q,
          acceptedAnswer: { "@type": "Answer", text: entry.a },
        })),
      },
    },
  ];
}

/*
 * A guided tour for someone choosing an i18n library: the promise in four
 * words, what changes, how one sentence travels through the toolchain (with
 * every term explained), why the core is native, why framework wiring is the
 * real work, the honest comparison, the receipts, and the people behind it.
 * PRODUCT.md owns the narrative; this file only arranges it.
 */
export default function Home() {
  return (
    <Page className="pmds-home">
      <HomeHero />
      <IntegrationBand />
      <BeforeAfter />
      <Journey />
      <RustRace />
      <FrameworkWiring />
      <RustApplications />
      <Chooser />
      <ProofSection />
      <OriginStory />

      <Band labelledBy="paths-title">
        <BandHeader
          id="paths-title"
          kicker="Your next step"
          title="Where are you starting from?"
          lede="Every team arrives with a different question. Pick yours — each path leads to the material that answers it."
        />
        <div className="mt-14">
          <QuestionRoutes />
        </div>
      </Band>

      <Band tone="parchment" labelledBy="faq-title">
        <BandHeader
          id="faq-title"
          kicker="Before you adopt it"
          title="Questions teams ask first."
          lede="Stability, ownership, and how Palamedes fits the way your translators already work."
        />
        <div className="mt-12">
          <HomeFaq />
        </div>
      </Band>

      <CtaBand
        headline="Write one sentence. Watch it speak German."
        lede="The guided setup takes you from installation to a rendered translation in your own stack — by hand, or with your coding agent."
        primary={{ label: "Start with your framework", href: "/get-started" }}
        secondary={{ label: "Browse the source", href: REPO }}
      />
    </Page>
  );
}
