import type { ReactNode } from "react";
import { AbsoluteFill, Sequence } from "remotion";

import { C } from "../brand";
import { JourneyFlight } from "../flight/JourneyFlight";
import { End } from "../scenes/End";
import { Rust } from "../scenes/Rust";
import { Wiring } from "../scenes/Wiring";
import { SnapCnUIProvider } from "@/lib/snap-cn-ui";

import { steady } from "../kinetic";
import { palamedesTheme } from "../snapcn-theme";
import { useBrandFonts } from "../ui";
import { Agent } from "./Agent";
import { Complete } from "./Complete";
import { Details } from "./Details";
import { FilmClaim } from "./FilmClaim";
import { Open } from "./Open";
import { Problems } from "./Problems";
import { Reveal } from "./Reveal";
import { at, FILM_SCENES, type FilmSection, JOURNEY_WARP } from "./timeline";

/*
 * The long cut, muted: picture only. Brian's takes, the score and the mix are
 * built outside Remotion from audio/cues/film.json and muxed afterwards. Scene
 * cues are seconds into each section, taken from the takes' word timings plus
 * the offset at which the cue sheet places each take.
 */
const PARTS: ReadonlyArray<readonly [FilmSection, ReactNode]> = [
  ["open", <Open key="open" />],
  ["hook", <Details key="hook" />],
  ["problems", <Problems key="problems" />],
  ["reveal", <Reveal key="reveal" />],
  ["journey", <JourneyFlight key="journey" anchors={JOURNEY_WARP} />],
  ["complete", <Complete key="complete" />],
  [
    "frameworks",
    <Wiring
      key="frameworks"
      cues={{
        marks: [at(2.4), at(3), at(3.95), at(5.2), at(6.2), at(6.65), at(7.75)],
        travel: [at(8.6), at(10.9)],
        bars: 4,
      }}
    />,
  ],
  ["fast", <Rust key="fast" />],
  ["agent", <Agent key="agent" />],
  ["claim", <FilmClaim key="claim" />],
  ["end", <End key="end" cues={{ domain: at(3.8), note: at(1.4), bars: 4, company: at(5.4) }} />],
];

export function PalamedesFilm() {
  useBrandFonts();
  return (
    <SnapCnUIProvider theme={palamedesTheme}>
      <AbsoluteFill style={{ background: C.mist, ...steady }}>
        {PARTS.map(([section, scene]) => (
          <Sequence
            key={section}
            from={FILM_SCENES[section].from}
            durationInFrames={FILM_SCENES[section].to - FILM_SCENES[section].from}
            name={section}
          >
            {scene}
          </Sequence>
        ))}
      </AbsoluteFill>
    </SnapCnUIProvider>
  );
}
