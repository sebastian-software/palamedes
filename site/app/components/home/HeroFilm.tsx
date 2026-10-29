import { useEffect, useRef, useState } from "ardo/react";

import { FILM, FILM_CREDITS, FILM_TRANSCRIPT } from "~/data/film";
import { trackEvent } from "~/lib/analytics";
import { enableAnalytics } from "~/lib/analytics-bootstrap";
import { observeBunnyPlayer, VideoCoverage } from "~/lib/video-analytics";

/*
 * The film in the hero, next to the promise it explains. Until someone presses
 * play it is only a poster and a button, so the page stays light and nothing
 * starts on its own; the click swaps in the Bunny player, which plays with
 * sound, captions and fullscreen. Without JavaScript the button sits inside a
 * link to the hosted player page.
 */
export function HeroFilm() {
  const [playing, setPlaying] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const coverage = useRef<VideoCoverage | null>(null);

  useEffect(() => {
    if (!playing || !frame.current || !enableAnalytics()) return;
    coverage.current ??= new VideoCoverage((name, properties) =>
      trackEvent(name, {
        ...properties,
        video_id: FILM.id,
        video_version: FILM.version,
        placement: "homepage-film",
      }),
    );
    return observeBunnyPlayer(frame.current, coverage.current);
  }, [playing]);

  return (
    <figure className="border border-ink/15 bg-paper">
      <div className="relative aspect-video w-full bg-mist">
        {playing ? (
          // Bunny's player needs its own origin and scripts; a sandbox allowing
          // both would be no sandbox at all, so the trusted player runs without one.
          // oxlint-disable-next-line react/iframe-missing-sandbox
          <iframe
            ref={frame}
            src={FILM.embed}
            title={FILM.title}
            className="absolute inset-0 size-full border-0"
            allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <a
            href={FILM.page}
            data-analytics-id="homepage-film-open"
            data-analytics-event="film_open"
            onClick={(event) => {
              event.preventDefault();
              setPlaying(true);
            }}
            className="group absolute inset-0 block focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            <img
              src={FILM.poster}
              alt=""
              width={1600}
              height={900}
              fetchPriority="high"
              className="block size-full object-cover"
            />
            <span className="absolute bottom-4 left-4 flex items-center border border-ink/20 bg-paper text-[15px] font-semibold text-ink group-hover:border-accent">
              <span aria-hidden className="grid size-11 place-items-center bg-accent">
                <span className="ml-0.5 size-0 border-y-[7px] border-l-[12px] border-y-transparent border-l-paper" />
              </span>
              <span className="px-4">Watch the film · {FILM.duration}</span>
            </span>
          </a>
        )}
      </div>
      <figcaption className="border-t border-hair px-4 py-2.5 text-[12px] leading-relaxed text-ink/65">
        {FILM_CREDITS}{" "}
        <details className="mt-1 inline">
          <summary className="inline cursor-pointer font-semibold text-ink/80 underline underline-offset-2">
            Transcript
          </summary>
          <span className="mt-2 block max-h-48 space-y-2 overflow-y-auto text-[13px] text-ink/85">
            {FILM_TRANSCRIPT.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </span>
        </details>
      </figcaption>
    </figure>
  );
}
