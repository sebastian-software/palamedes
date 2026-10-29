import { useState } from "react";

import { Band } from "~/components/marketing/Band";
import { FILM_CREDITS } from "~/data/film";
import { LAUNCH_FILM, LAUNCH_FILM_TRANSCRIPT } from "~/data/launch-film";

export function LaunchFilm() {
  const [playing, setPlaying] = useState(false);

  return (
    <Band id="launch-film" tone="parchment" labelledBy="launch-film-title">
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div>
          <p className="pmds-kicker">Palamedes 2.0</p>
          <h2 id="launch-film-title" className="pmds-title">
            Watch the launch film.
          </h2>
          <p className="mt-6 text-[18px] leading-relaxed text-ink/80">
            Ask your agent for translations. See how Palamedes connects the sentence to the screen
            in 70 seconds.
          </p>
          <p id="launch-film-privacy" className="mt-4 text-[13px] leading-relaxed text-ink/70">
            Playing loads YouTube and shares connection data with Google. English captions included.
          </p>
          <a
            href={LAUNCH_FILM.page}
            className="mt-4 inline-block text-[14px] font-semibold text-accent underline underline-offset-4 hover:text-ink"
          >
            Watch on YouTube
          </a>
        </div>
        <figure className="min-w-0 border border-ink/15 bg-paper">
          <div className="relative aspect-video min-h-[200px] w-full bg-mist">
            {playing ? (
              // The trusted YouTube player needs its own scripts and origin.
              // oxlint-disable-next-line react/iframe-missing-sandbox
              <iframe
                src={LAUNCH_FILM.embed}
                title={LAUNCH_FILM.title}
                className="absolute inset-0 size-full border-0"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <a
                href={LAUNCH_FILM.page}
                aria-describedby="launch-film-privacy"
                data-analytics-id="homepage-launch-film-open"
                data-analytics-event="film_open"
                onClick={(event) => {
                  event.preventDefault();
                  setPlaying(true);
                }}
                className="group absolute inset-0 block focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
              >
                <img
                  src={LAUNCH_FILM.poster}
                  alt=""
                  width={1600}
                  height={900}
                  loading="lazy"
                  className="block size-full object-cover"
                />
                <span className="absolute bottom-4 left-4 flex items-center border border-ink/20 bg-paper text-[15px] font-semibold text-ink group-hover:border-accent">
                  <span aria-hidden className="grid size-11 place-items-center bg-accent">
                    <span className="ml-0.5 size-0 border-y-[7px] border-l-[12px] border-y-transparent border-l-paper" />
                  </span>
                  <span className="px-4">Play on YouTube · {LAUNCH_FILM.duration}</span>
                </span>
              </a>
            )}
          </div>
          <figcaption className="border-t border-hair px-4 py-2.5 text-[12px] leading-relaxed text-ink/65">
            {FILM_CREDITS}{" "}
            <details className="mt-1">
              <summary className="cursor-pointer font-semibold text-ink/80 underline underline-offset-2">
                Launch film transcript
              </summary>
              <div className="mt-2 max-h-48 space-y-2 overflow-y-auto text-[13px] text-ink/85">
                {LAUNCH_FILM_TRANSCRIPT.map((line) => (
                  <p key={line}>{line}</p>
                ))}
              </div>
            </details>
          </figcaption>
        </figure>
      </div>
    </Band>
  );
}
