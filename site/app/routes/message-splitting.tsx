import { ButtonLink, Page, Section } from "@palamedes/site-ui";
import { FragmentDemo } from "~/components/FragmentDemo";
import { PageHero } from "~/components/marketing/PageHero";
import { PlainWords } from "~/components/marketing/PlainWords";
import { V2ReleaseNotice } from "~/components/V2ReleaseNotice";
import { pageMeta } from "~/lib/meta";
import { repoHref } from "~/data/links";

export const handle = { layout: "bare" };
export function meta() {
  return pageMeta({
    title: "Palamedes message splitting — a live fragment demo",
    description:
      "Watch a real Vite/React application load active-locale translation fragments on entry and navigation. Compare its loaded messages with the whole catalog.",
    path: "/message-splitting",
  });
}

export default function MessageSplitting() {
  return (
    <Page>
      <PageHero
        kicker="Message splitting"
        title="Load the view. Load its messages."
        lede="Your first screen doesn’t need every translation in the application. Open the small workspace below and watch the translations for each view arrive together with its code — and not a moment earlier."
        aside={
          <PlainWords
            question="What is message splitting?"
            answer="Modern apps are already split into pieces that load when needed — a route, a dialog, a settings screen. Palamedes splits the translations along the same lines: each piece carries the messages it uses, in the visitor’s language only. The first screen gets lighter, and nobody downloads text for screens they never open."
          />
        }
      >
        <V2ReleaseNotice className="mt-7 max-w-[40rem]" />
      </PageHero>
      <Section
        num="01 — Live demo"
        eyebrow="Real compiled fragments"
        title="Start small. Add a view."
        lede="Overview is part of the entry module. Projects and Billing are ordinary dynamic imports. Open either view, return to Overview, then change language or restart the document."
      >
        <FragmentDemo />
      </Section>
      <Section
        num="02 — What changes"
        eyebrow="The useful difference"
        title="Defer translations with the code that uses them."
      >
        <div className="grid grid-cols-3 gap-10 text-[16px] leading-relaxed text-ink/85 max-grid:grid-cols-1">
          <div>
            <h3 className="text-[18px] font-bold text-ink">On entry</h3>
            <p className="mt-3">
              The adapter supplies the first view's compiled messages before it runs. Unopened views
              keep their translations deferred.
            </p>
          </div>
          <div>
            <h3 className="text-[18px] font-bold text-ink">On navigation</h3>
            <p className="mt-3">
              An ordinary lazy module brings its active-locale fragment. Return to a loaded view and
              the document reuses the module.
            </p>
          </div>
          <div>
            <h3 className="text-[18px] font-bold text-ink">In your application</h3>
            <p className="mt-3">
              Write messages beside the UI. The adapter wires the catalog dependencies; your
              application keeps its usual code-splitting boundaries.
            </p>
          </div>
        </div>
        <p className="mt-8 max-w-[60em] text-[14px] leading-relaxed text-ink/80">
          This is a browser-delivery demonstration of the workspace's Vite adapter, not an SSR,
          server-memory, or timing benchmark. Eagerly imported application code still brings its
          messages on entry. Fragment and import-map overhead matters, especially in small apps. The
          Next.js adapter follows the same graph-delivery contract; its host behavior has separate
          integration checks.
        </p>
        <div className="mt-6 flex flex-wrap gap-4">
          <ButtonLink variant="small" href="/get-started#install">
            Set up your framework
          </ButtonLink>
          <ButtonLink variant="outline" href={repoHref("site/fragment-demo", "tree")}>
            Inspect the demo source
          </ButtonLink>
          <ButtonLink variant="outline" href="/docs/api/vite-plugin">
            Read the adapter guide
          </ButtonLink>
        </div>
      </Section>
    </Page>
  );
}
