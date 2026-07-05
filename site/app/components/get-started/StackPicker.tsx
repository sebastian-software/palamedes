import { Tabs } from "@base-ui-components/react/tabs"

/*
 * Visual stack picker. React is the fully worked path today (mirrors
 * docs/first-working-translation.md); Solid and Next.js link out instead of
 * duplicating a half-maintained flow.
 */
export function StackPicker() {
  return (
    <Tabs.Root defaultValue="react">
      <Tabs.List className="inline-flex border border-hair">
        <Tabs.Tab
          value="react"
          className="micro border-r border-hair px-5 py-2.5 text-[11px] tracking-label data-[selected]:bg-ink data-[selected]:text-paper"
        >
          Vite + React
        </Tabs.Tab>
        <Tabs.Tab
          value="solid"
          disabled
          className="micro border-r border-hair px-5 py-2.5 text-[11px] tracking-label text-gray-spec"
        >
          Vite + Solid
        </Tabs.Tab>
        <Tabs.Tab
          value="next"
          disabled
          className="micro px-5 py-2.5 text-[11px] tracking-label text-gray-spec"
        >
          Next.js
        </Tabs.Tab>
      </Tabs.List>
    </Tabs.Root>
  )
}
