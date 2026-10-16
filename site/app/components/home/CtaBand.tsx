import { ButtonLink } from "@palamedes/site-ui";

interface Cta {
  label: string;
  href: string;
}

/*
 * The closing invitation on every marketing page: one navy band, one
 * sentence, one primary step. The meander marks it as the page's last word.
 */
export function CtaBand({
  headline,
  lede,
  primary,
  secondary,
}: {
  headline: string;
  lede?: string;
  primary: Cta;
  secondary?: Cta;
}) {
  return (
    <section className="pmds-band pmds-band--mist relative" aria-label="Next step">
      <div className="meander absolute inset-x-0 top-0" aria-hidden />
      <h2 className="display-serif max-w-[18em] text-[clamp(2rem,4.2vw,3.5rem)] leading-[1.08] text-balance">
        {headline}
      </h2>
      {lede ? (
        <p className="mt-6 max-w-[38rem] text-[clamp(1.0625rem,0.95rem+0.4vw,1.25rem)] leading-[1.65] text-ink/80">
          {lede}
        </p>
      ) : null}
      <div className="mt-10 flex flex-wrap gap-3">
        <ButtonLink href={primary.href}>{primary.label}</ButtonLink>
        {secondary ? (
          <ButtonLink variant="outline" href={secondary.href}>
            {secondary.label}
          </ButtonLink>
        ) : null}
      </div>
    </section>
  );
}
