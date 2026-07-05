import { Tabs } from "@base-ui-components/react/tabs"
import { StepFlow } from "~/components/get-started/StepFlow"
import { QUICKSTART_STEPS, STACKS } from "~/data/steps"

export function StackPicker() {
  return (
    <Tabs.Root defaultValue="react">
      <Tabs.List className="inline-flex border border-hair">
        {STACKS.map((stack, index) => (
          <Tabs.Tab
            key={stack.id}
            value={stack.id}
            className={`micro px-5 py-2.5 text-[11px] tracking-label transition-colors hover:text-accent data-[selected]:bg-ink data-[selected]:text-paper ${
              index < STACKS.length - 1 ? "border-r border-hair" : ""
            }`}
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
