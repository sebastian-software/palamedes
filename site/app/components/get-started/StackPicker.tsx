import { Tabs } from "@base-ui/react/tabs"
import { StepFlow } from "~/components/get-started/StepFlow"
import { QUICKSTART_STEPS, STACKS } from "~/data/steps"

export function StackPicker() {
  return (
    <Tabs.Root defaultValue="react">
      <Tabs.List className="inline-flex max-w-full flex-wrap border-l border-t border-hair">
        {STACKS.map((stack) => (
          <Tabs.Tab
            key={stack.id}
            value={stack.id}
            className="micro min-h-11 border-r border-b border-hair px-5 py-2.5 text-[11px] tracking-label transition-colors hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent data-[selected]:bg-ink data-[selected]:text-paper"
          >
            {stack.label}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {STACKS.map((stack) => (
        <Tabs.Panel key={stack.id} value={stack.id} className="mt-8">
          <StepFlow steps={QUICKSTART_STEPS[stack.id]} />
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  )
}
