import { ButtonLink, Page, Section } from "@palamedes/site-ui";
import { FragmentDemo } from "~/components/FragmentDemo";
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
      <section className="px-8 pt-16 pb-14 max-tight:px-5">
        <p className="eyebrow">Message splitting</p>
        <h1 className="mt-6 max-w-[15em] text-display leading-[0.98] font-bold tracking-[-0.03em] text-balance">
          Load the view. Load its messages.
        </h1>
        <p className="mt-6 max-w-[38em]">
          Your first screen does not need every translation in the application. Try this small
          workspace and watch the active-language fragments follow the modules you open.
        </p>
        <V2ReleaseNotice className="mt-7 max-w-[44rem]" />
      </section>
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
        <div className="grid grid-cols-3 gap-8 max-grid:grid-cols-1 text-[15px] leading-relaxed">
          <div>
            <h3 className="font-bold">On entry</h3>
            <p className="mt-3">
              The adapter supplies the first view's compiled messages before it runs. Unopened views
              keep their translations deferred.
            </p>
          </div>
          <div>
            <h3 className="font-bold">On navigation</h3>
            <p className="mt-3">
              An ordinary lazy module brings its active-locale fragment. Return to a loaded view and
              the document reuses the module.
            </p>
          </div>
          <div>
            <h3 className="font-bold">In your application</h3>
            <p className="mt-3">
              Author macros beside the UI. The adapter wires catalog dependencies; the application
              owns its usual code-splitting boundaries.
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
