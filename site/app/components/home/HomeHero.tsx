import { ButtonLink } from "@palamedes/site-ui"

export function HomeHero() {
  return (
    <section className="border-b border-hair px-8 pt-8 pb-16 max-tight:px-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center border-y border-hair py-3 max-tight:grid-cols-[1fr_auto]">
        <p className="micro text-[10px] tracking-label text-ink/70">
          Open-source i18n for TypeScript
        </p>
        <img src="/logo.svg" alt="" aria-hidden width={42} height={42} className="size-10" />
        <p className="micro text-right text-[10px] tracking-label text-ink/70 max-tight:hidden">
          Source to runtime · MIT
        </p>
      </div>

      <div className="mx-auto max-w-[64rem] pt-14 text-center">
        <p className="eyebrow">A foundation you can keep</p>
        <h1 className="display-serif mt-7 uppercase">
          <span className="block text-[clamp(2.2rem,6.5vw,5.8rem)] leading-[0.92] tracking-[-0.025em]">
            Clear. Complete. Fast.
          </span>
          <span className="mt-3 block text-[clamp(2.6rem,8.3vw,7.5rem)] leading-[0.9] tracking-[-0.035em] text-accent">
            Pick three.
          </span>
        </h1>
        <p className="mx-auto mt-8 max-w-[48rem] text-[17px] leading-[1.7] text-ink/90 max-tight:text-[15px]">
          Build i18n on one coherent TypeScript foundation: source-local messages, first-party
          framework integrations, four proven locale architectures, repository-owned catalogs, and a
          native toolchain that stays fast as the codebase grows.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/frameworks">Choose your framework</ButtonLink>
          <ButtonLink variant="outline" href="/proof">
            Inspect the evidence
          </ButtonLink>
        </div>
      </div>
    </section>
  )
}
