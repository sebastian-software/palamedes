import type { ReactNode } from "react"

import { Reveal } from "./Reveal"

interface SectionProps {
  num?: string
  title?: ReactNode
  eyebrow?: string
  lede?: ReactNode
  id?: string
  dark?: boolean
  children?: ReactNode
}

/*
 * A ledger row of the spec sheet: hairline top rule, mono section mark
 * ("01 — Model"), optional headline and lede, then content.
 */
export function Section({ num, title, eyebrow, lede, id, dark, children }: SectionProps) {
  return (
    <section
      id={id}
      className={`border-t border-hair px-8 pt-14 pb-16 max-tight:px-5 ${
        dark ? "bg-ink text-paper" : ""
      }`}
    >
      <Reveal>
        {num ? (
          <p className={`micro tracking-th ${dark ? "text-accent-soft" : "text-gray-spec"}`}>
            {num}
          </p>
        ) : null}
        {eyebrow ? <p className="eyebrow mt-6">{eyebrow}</p> : null}
        {title ? (
          <h2 className="display-serif mt-4 max-w-[24em] text-h2 leading-[1.25]">{title}</h2>
        ) : null}
        {lede ? <p className={`mt-4 max-w-[44em] ${dark ? "" : "text-ink"}`}>{lede}</p> : null}
      </Reveal>
      {children ? <div className="mt-10">{children}</div> : null}
    </section>
  )
}
