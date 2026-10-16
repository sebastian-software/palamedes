import { Tabs } from "@base-ui/react/tabs";
import { ButtonLink } from "@palamedes/site-ui";
import { StepFlow } from "~/components/get-started/StepFlow";
import { QUICKSTART_STEPS, STACKS, type StackId } from "~/data/steps";
import { docsHref } from "~/data/links";

const GUIDES: Record<StackId, string> = {
  react: docsHref("first-working-translation"),
  solid: docsHref("api/vite-plugin"),
  next: docsHref("nextjs-first-run"),
};

export function StackPicker() {
  return (
    <Tabs.Root defaultValue="react">
      <Tabs.List className="inline-flex max-w-full flex-wrap border-l border-t border-hair">
        {STACKS.map((stack) => (
          <Tabs.Tab
            key={stack.id}
            value={stack.id}
            className="micro min-h-11 border-r border-b border-hair px-5 py-2.5 text-[11px] tracking-label transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent data-[selected]:bg-mist data-[selected]:font-semibold data-[selected]:text-ink data-[selected]:border-b-accent"
          >
            {stack.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {STACKS.map((stack) => (
        <Tabs.Panel key={stack.id} value={stack.id} className="mt-8">
          <StepFlow steps={QUICKSTART_STEPS[stack.id]} />
          <ButtonLink variant="small" className="mt-6" href={GUIDES[stack.id]}>
            Read the full {stack.label} guide
          </ButtonLink>
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}
