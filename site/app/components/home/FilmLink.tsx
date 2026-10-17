import { useEffect, useRef } from "react";

import { FILM, FILM_CREDITS, FILM_TRANSCRIPT } from "~/data/film";

/*
 * The film behind a link, as on dalo.sh: it takes no room on the page, so
 * the tour still reaches its first example early. The link opens a dialog and
 * starts the film; without JavaScript it leads to the video file itself.
 * Closing the dialog pauses playback. Captions are on by default and the
 * transcript sits below the player.
 */
export function FilmLink() {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  // The native close event fires for the button, Escape, and form methods alike.
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const pause = () => video.current?.pause();
    element.addEventListener("close", pause);
    return () => element.removeEventListener("close", pause);
  }, []);

  return (
    <>
      <a
        href={FILM.src}
        onClick={(event) => {
          const element = dialog.current;
          if (!element || typeof element.showModal !== "function") return;
          event.preventDefault();
          element.showModal();
          void video.current?.play().catch(() => null);
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
          <video
            ref={video}
            className="block aspect-video h-auto w-full bg-mist"
            controls
            preload="none"
            playsInline
            poster={FILM.poster}
            width={FILM.width}
            height={FILM.height}
          >
            <source src={FILM.src} type="video/mp4" />
            <track kind="captions" srcLang="en" label="English" src={FILM.captions} default />
          </video>
          <figcaption className="border-t border-hair px-5 py-3 text-[13px] leading-relaxed text-ink/70">
            {FILM_CREDITS}
          </figcaption>
        </figure>
        <details className="mt-4 border border-ink/15 bg-paper px-5 py-1">
          <summary className="flex min-h-11 cursor-pointer items-center text-[15px] font-semibold text-ink">
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
