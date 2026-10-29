import { useState } from "ardo/react";
import { ArdoLink as Link } from "ardo/runtime";

/*
 * An illustration, not a measurement: four screens of an app and the German
 * messages each one needs. The entry screen's messages arrive with the first
 * page; the others arrive when their screen is opened. The live demo at
 * /message-splitting shows real compiled fragments and byte receipts.
 */
const SCREENS = [
  { id: "home", name: "Home", entry: true },
  { id: "search", name: "Search", entry: false },
  { id: "trip", name: "Trip details", entry: false },
  { id: "checkout", name: "Checkout", entry: false },
] as const;

type ScreenId = (typeof SCREENS)[number]["id"];

export function SplitDiagram() {
  const [opened, setOpened] = useState<ReadonlySet<ScreenId>>(() => new Set(["home"]));

  return (
    <figure className="border border-ink bg-paper">
      <p className="micro border-b border-hair px-5 py-3 text-[11px] tracking-label text-gray-spec">
        Illustration · open a screen
      </p>
      <ul className="divide-y divide-hair">
        {SCREENS.map((screen) => {
          const loaded = opened.has(screen.id);
          return (
            <li
              key={screen.id}
              className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-4 px-5 py-4 max-tight:grid-cols-1 max-tight:gap-2"
            >
              <button
                type="button"
                data-analytics-id={`split-screen-${screen.id}`}
                data-analytics-event="demo_screen"
                data-analytics-value={screen.id}
                aria-pressed={loaded}
                disabled={screen.entry}
                onClick={() => setOpened((current) => new Set([...current, screen.id]))}
                className="min-h-11 border border-ink px-3 text-left text-[14px] font-semibold transition-colors hover:bg-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:hover:bg-mist aria-pressed:bg-mist"
              >
                {screen.name}
              </button>
              <p className="flex items-center gap-3 text-[14.5px]">
                <span
                  aria-hidden
                  className={`h-3 shrink-0 transition-[width,background-color] duration-500 ${loaded ? "w-16 bg-accent" : "w-16 border border-dashed border-gray-spec bg-transparent"}`}
                />
                <span className={loaded ? "text-ink" : "text-gray-spec"}>
                  {screen.entry
                    ? "German messages arrive with the first page"
                    : loaded
                      ? "German messages loaded with this screen"
                      : "Not downloaded — nobody opened it yet"}
                </span>
              </p>
            </li>
          );
        })}
      </ul>
      <figcaption className="border-t border-hair px-5 py-3 text-[13px] leading-relaxed text-ink/75">
        Only the visitor’s language, only for screens they open.{" "}
        <Link to="/message-splitting" className="text-accent underline underline-offset-4">
          Watch real fragments load in the live demo →
        </Link>
      </figcaption>
    </figure>
  );
}
