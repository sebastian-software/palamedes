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
    <section className="grid grid-cols-[1fr_auto] items-center gap-10 border-t border-hair px-8 py-14 max-tight:grid-cols-1 max-tight:px-5">
      <div>
        <h2 className="display-serif max-w-[24em] text-h2 leading-[1.25] uppercase">{headline}</h2>
        <div className="mt-8 flex flex-wrap gap-3">
          <ButtonLink href={primary.href}>{primary.label}</ButtonLink>
          {secondary ? (
            <ButtonLink variant="outline" href={secondary.href}>
              {secondary.label}
            </ButtonLink>
          ) : null}
        </div>
      </div>
      <img src="/logo.svg" alt="" aria-hidden className="w-32 max-tight:hidden" />
    </section>
  )
}
