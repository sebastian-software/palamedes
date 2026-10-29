import { ButtonLink } from "@palamedes/site-ui";

import { AgentStart } from "./AgentStart";
import { HeroFilm } from "./HeroFilm";

/*
 * The first screen states the whole idea in four words, offers two doors —
 * start now, or have it explained first — and shows the promise in a
 * short film that plays only when asked.
 */
export function HomeHero() {
  return (
    <section
      className="pmds-hero pmds-band--mist relative overflow-hidden"
      aria-labelledby="home-title"
    >
      <img
        src="/logo.svg"
        alt=""
        aria-hidden
        width={240}
        height={240}
        className="pointer-events-none absolute -top-16 -right-40 w-[min(52rem,72vw)] opacity-[0.07] max-lg:hidden"
      />
      <div className="relative mx-auto grid max-w-[var(--pmds-measure)] grid-cols-1 items-center gap-x-16 gap-y-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div>
          <p className="pmds-kicker">Open-source i18n for TypeScript &amp; Rust</p>
          <h1 id="home-title" className="pmds-hero-title [--text-hero:clamp(2.45rem,5.6vw,4.4rem)]">
            Just write
            <span className="block text-accent">the sentence.</span>
          </h1>
          <p className="mt-8 max-w-[36rem] text-[clamp(1.125rem,1rem+0.5vw,1.375rem)] leading-[1.6] text-ink/85">
            Translate your frontend, backend, command-line tools, MDX documentation, and Rust
            applications. Write messages in your source, keep translations in Git, and use one local
            toolchain from extraction to compiled catalogs.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <ButtonLink href="#applications">Find your starting point</ButtonLink>
            <ButtonLink variant="outline" href="#journey">
              Show me how it works
            </ButtonLink>
          </div>
          <p className="mt-6 max-w-[36rem] text-[13.5px] leading-relaxed text-ink/70">
            Palamedes 2.0 is out.{" "}
            <a
              href="/docs/release-notes-v2"
              className="text-accent underline underline-offset-4 hover:text-ink"
            >
              Read the release notes
            </a>
            .
          </p>
        </div>
        <div>
          <HeroFilm />
          <AgentStart />
        </div>
      </div>
    </section>
  );
}
