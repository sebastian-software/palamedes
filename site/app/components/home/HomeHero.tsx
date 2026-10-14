import { ButtonLink } from "@palamedes/site-ui";
import { V2ReleaseNotice } from "~/components/V2ReleaseNotice";

export function HomeHero() {
  return (
    <section className="border-b border-hair px-8 pt-8 pb-16 max-tight:px-5">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center border-y border-hair py-3 max-tight:grid-cols-[1fr_auto]">
        <p className="micro text-[10px] tracking-label text-ink/70">
          Open-source i18n for TypeScript
        </p>
        <img src="/logo.svg" alt="" aria-hidden width={42} height={42} className="size-10" />
        <p className="micro text-right text-[10px] tracking-label text-ink/70 max-tight:hidden">
          Source to runtime · MIT OR Apache-2.0
        </p>
      </div>

      <div className="mx-auto max-w-[64rem] pt-14 text-center">
        <p className="eyebrow">A foundation you can keep</p>
        <h1 className="display-serif mt-7 uppercase">
          <span className="flex flex-nowrap justify-center gap-x-[0.22em] text-[clamp(2.15rem,6.1vw,5.8rem)] leading-[0.92] tracking-[-0.025em] max-tight:flex-wrap max-tight:gap-x-[0.14em]">
            <span>Clear.</span>
            <span>Complete.</span>
            <span>Fast.</span>
          </span>
          <span className="mt-3 block text-[clamp(2.6rem,8.3vw,7.5rem)] leading-[0.9] tracking-[-0.035em] text-accent">
            Pick three.
          </span>
        </h1>
        <p className="mx-auto mt-8 max-w-[48rem] text-[17px] leading-[1.7] text-ink/90 max-tight:text-[15px]">
          Write readable messages with ready-made components. Connect your framework with a
          first-party adapter. Compile translations ahead of time and keep catalog work fast with a
          native toolchain. One i18n foundation, from your first component to a growing application.
        </p>
        <div className="mt-9 flex flex-wrap justify-center gap-3">
          <ButtonLink href="/get-started#install">Start with your framework</ButtonLink>
          <ButtonLink variant="outline" href="/docs/release-notes-v2">
            Explore Palamedes 2.0
          </ButtonLink>
        </div>
        <V2ReleaseNotice className="mx-auto mt-7 max-w-[42rem]" />
      </div>
    </section>
  );
}
