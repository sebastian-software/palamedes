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

export function Section({ num, title, eyebrow, lede, id, dark, children }: SectionProps) {
  return (
    <section id={id} className={`pmds-section${dark ? " pmds-section--dark" : ""}`}>
      <Reveal>
        {num ? (
          <p className={`pmds-section-number${dark ? " pmds-section-number--dark" : ""}`}>{num}</p>
        ) : null}
        {eyebrow ? <p className="pmds-section-eyebrow">{eyebrow}</p> : null}
        {title ? <h2 className="pmds-section-title">{title}</h2> : null}
        {lede ? <p className="pmds-section-lede">{lede}</p> : null}
      </Reveal>
      {children ? <div className="pmds-section-content">{children}</div> : null}
    </section>
  )
}
