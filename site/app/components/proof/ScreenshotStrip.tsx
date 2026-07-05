import nextjsRoute from "~/assets/screenshots/nextjs-route-interactive.png"
import reactRouterCookie from "~/assets/screenshots/react-router-cookie-interactive.png"
import solidstartRoute from "~/assets/screenshots/solidstart-route-interactive.png"
import wakuCookie from "~/assets/screenshots/waku-cookie-interactive.png"
import { docsHref } from "~/data/links"

interface Shot {
  src: string
  caption: string
  url: string
}

const SHOTS: Shot[] = [
  { src: nextjsRoute, caption: "nextjs-route · /de · CI run", url: "nextjs-route…/de" },
  {
    src: reactRouterCookie,
    caption: "react-router-cookie · de · CI run",
    url: "react-router-cookie…",
  },
  { src: solidstartRoute, caption: "solidstart-route · /de · CI run", url: "solidstart-route…/de" },
  { src: wakuCookie, caption: "waku-cookie · de · CI run", url: "waku-cookie…" },
]

/*
 * Filmstrip of real, versioned Playwright captures — the "diffable artifact"
 * the copy talks about. Four of the twenty; the link leads to the full set.
 */
export function ScreenshotStrip() {
  return (
    <div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {SHOTS.map((shot) => (
          <figure key={shot.caption} className="w-72 shrink-0 border border-hair">
            <div className="flex items-center gap-1.5 border-b border-hair px-3 py-2">
              <span className="block size-1.5 border border-hair bg-track" />
              <span className="block size-1.5 border border-hair bg-track" />
              <span className="block size-1.5 border border-hair bg-track" />
              <span className="mono-nums ml-1 truncate text-[9px] text-gray-spec">{shot.url}</span>
            </div>
            <img
              src={shot.src}
              alt={`Versioned CI screenshot: ${shot.caption}`}
              width={288}
              height={216}
              loading="lazy"
              className="block w-full"
            />
            <figcaption className="mono-nums border-t border-hair px-3 py-2 text-[10px] text-gray-spec">
              {shot.caption}
            </figcaption>
          </figure>
        ))}
      </div>
      <a
        href={docsHref("example-screenshots")}
        className="mono-nums mt-3 inline-block text-[13px] text-accent"
      >
        All 20 versioned screenshots →
      </a>
    </div>
  )
}
