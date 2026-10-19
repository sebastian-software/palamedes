import { useEffect, useRef, useState } from "react";

import { FILM, FILM_CREDITS, FILM_TRANSCRIPT } from "~/data/film";
import { trackEvent } from "~/lib/analytics";
import { enableAnalytics } from "~/lib/analytics-bootstrap";
import { observeBunnyPlayer, VideoCoverage } from "~/lib/video-analytics";

/*
 * The film behind a link, as on dalo.sh: it takes no room on the page, so
 * the tour still reaches its first example early. The link opens a dialog and
 * only then loads the Bunny player, which starts because the reader asked for
 * it; closing the dialog removes the player and stops playback. Without
 * JavaScript the link opens the hosted player page.
 */
export function FilmLink() {
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const coverage = useRef<VideoCoverage | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || !frame.current || !enableAnalytics()) return;
    coverage.current ??= new VideoCoverage((name, properties) =>
      trackEvent(name, {
        ...properties,
        video_id: FILM.id,
        video_version: FILM.version,
        placement: "homepage-film",
      }),
    );
    return observeBunnyPlayer(frame.current, coverage.current);
  }, [open]);

  // The native close event fires for the button, Escape, and form methods alike.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const close = () => setOpen(false);
    element.addEventListener("close", close);
    return () => element.removeEventListener("close", close);
  }, []);

  return (
    <>
      <a
        href={FILM.page}
        data-analytics-id="homepage-film-open"
        data-analytics-event="film_open"
        onClick={(event) => {
          const element = dialog.current;
          if (!element || typeof element.showModal !== "function") return;
          event.preventDefault();
          setOpen(true);
          element.showModal();
        }}
        className="mt-5 inline-flex min-h-11 items-center gap-3 text-[15px] font-semibold text-ink underline-offset-4 hover:text-accent hover:underline"
      >
        <span
          aria-hidden
          className="size-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-accent"
        />
        Watch the film · {FILM.duration}
      </a>
      <dialog
        ref={dialog}
        aria-label={FILM.title}
        className="m-auto w-[min(72rem,calc(100vw-2rem))] max-w-none bg-transparent p-0 pt-14 backdrop:bg-mist/95"
      >
        <button
          type="button"
          data-analytics-id="homepage-film-close"
          aria-label="Close the film"
          onClick={() => dialog.current?.close()}
          className="absolute top-0 right-0 grid size-11 place-items-center border border-ink/20 bg-paper text-ink hover:bg-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden focusable="false">
            <path
              d="m4 4 8 8M12 4l-8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="square"
            />
          </svg>
        </button>
        <figure className="border border-ink/15 bg-paper">
          <div className="aspect-video w-full bg-mist">
            {open ? (
              // Bunny's player needs its own origin and scripts; a sandbox allowing
              // both would be no sandbox at all, so the trusted player runs without one.
              // oxlint-disable-next-line react/iframe-missing-sandbox
              <iframe
                ref={frame}
                src={FILM.embed}
                title={FILM.title}
                className="block size-full border-0"
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : null}
          </div>
          <figcaption className="border-t border-hair px-5 py-3 text-[13px] leading-relaxed text-ink/70">
            {FILM_CREDITS}
          </figcaption>
        </figure>
        <details className="mt-4 border border-ink/15 bg-paper px-5 py-1">
          <summary
            data-analytics-id="film-transcript"
            className="flex min-h-11 cursor-pointer items-center text-[15px] font-semibold text-ink"
          >
            Read what the film says
          </summary>
          <div className="mt-2 mb-4 max-h-[40vh] space-y-3 overflow-y-auto text-[15px] leading-relaxed text-ink/85">
            {FILM_TRANSCRIPT.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </details>
      </dialog>
    </>
  );
}
