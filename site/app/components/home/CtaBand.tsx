import { ButtonLink } from "~/components/chrome/Button"

interface Cta {
  label: string
  href: string
}

export function CtaBand({
  headline,
  primary,
  secondary,
}: {
  headline: string
  primary: Cta
  secondary?: Cta
}) {
  return (
    <section className="border-t border-hair px-8 py-14 max-tight:px-5">
      <h2 className="max-w-[22em] text-h2 leading-[1.15] font-bold tracking-[-0.02em]">
        {headline}
      </h2>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href={primary.href}>{primary.label}</ButtonLink>
        {secondary ? (
          <ButtonLink variant="outline" href={secondary.href}>
            {secondary.label}
          </ButtonLink>
        ) : null}
      </div>
    </section>
  )
}
