import { Tabs } from "@base-ui-components/react/tabs"

import { LocaleBookingCards } from "./LocaleBookingCards"

interface CodeTab {
  id: string
  label: string
  caption: string
  code: string
}

/*
 * Code content verbatim from docs/site/structure/pages/HomePage.jsx.
 * Highlighting is done with hand-marked spans at render time via simple
 * line-level tones — faithful and dependency-free.
 */
const TABS: CodeTab[] = [
  {
    id: "write",
    label: "Write",
    caption: "Messages live where the UI happens.",
    code: `import { t, plural } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react"

export function Booking({ seats }: { seats: number }) {
  return (
    <>
      <h1>{t\`Your trip to Lisbon\`}</h1>
      <p>{plural(seats, { one: "# seat left", other: "# seats left" })}</p>
      <Trans>Free cancellation until <b>24 hours</b> before departure.</Trans>
    </>
  )
}`,
  },
  {
    id: "extract",
    label: "Extract",
    caption: "One native command scans, extracts, and updates catalogs.",
    code: `$ pmds extract

✓ Extracted 3 messages from 1 file (34ms)

  en  3 messages  (1 new)
  de  3 messages  (1 missing translation)`,
  },
  {
    id: "translate",
    label: "Translate",
    caption: "Source-string-first .po — readable by translators and every TMS.",
    code: `#: src/Booking.tsx:7
msgid "Your trip to Lisbon"
msgstr "Deine Reise nach Lissabon"

#: src/Booking.tsx:8
msgid "{seats, plural, one {# seat left} other {# seats left}}"
msgstr "{seats, plural, one {# Platz frei} other {# Plätze frei}}"`,
  },
]

/* Code lines keyed by their line number — the stable identity of a code line. */
function toLines(code: string): { no: number; text: string }[] {
  return code.split("\n").map((text, index) => ({ no: index + 1, text }))
}

function toneFor(line: string): string {
  if (line.startsWith("import ") || line.startsWith("export ")) {
    return "text-accent-soft"
  }
  if (line.startsWith("#") || line.startsWith("//")) {
    return "text-gray-spec"
  }
  if (line.startsWith("✓")) {
    return "text-term-ok"
  }
  if (line.startsWith("$")) {
    return "text-paper"
  }
  return "text-paper/85"
}

export function CodeShowcase() {
  return (
    <div className="border border-hair">
      <Tabs.Root defaultValue="write">
        <Tabs.List className="flex border-b border-hair">
          {TABS.map((tab) => (
            <Tabs.Tab
              key={tab.id}
              value={tab.id}
              className="micro border-r border-hair px-5 py-3 text-[11px] tracking-label text-gray-spec transition-colors hover:text-accent data-[selected]:bg-ink data-[selected]:text-paper"
            >
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {TABS.map((tab) => (
          <Tabs.Panel key={tab.id} value={tab.id}>
            <pre className="overflow-x-auto bg-ink px-5 py-4 font-mono text-[12.5px] leading-[1.7]">
              {toLines(tab.code).map((line) => (
                <div key={line.no} className={toneFor(line.text)}>
                  {line.text || " "}
                </div>
              ))}
            </pre>
            <p className="border-t border-hair px-5 py-3 text-[12.5px] text-gray-spec">
              {tab.caption}
            </p>
          </Tabs.Panel>
        ))}
      </Tabs.Root>
      <div className="border-t border-hair px-5 py-5">
        <p className="micro text-[10px] tracking-label text-gray-spec">Rendered</p>
        <p className="mt-1 mb-4 text-[13.5px]">
          The same component, in every locale, in every framework.
        </p>
        <div className="max-w-[26em]">
          <LocaleBookingCards />
        </div>
      </div>
    </div>
  )
}
