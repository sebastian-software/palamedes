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
 * The product film, muted: picture only. Brian's takes, the score and the mix are
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
        marks: {
          nextjs: at(2.4),
          nuxt: at(3.75),
          sveltekit: at(4.55),
          tanstack: at(5.5),
          "react-router": at(6.5),
          waku: at(7.7),
          remix: at(8.25),
          react: at(9.4),
          solid: at(10.3),
          vue: at(11),
          svelte: at(11.45),
          vite: at(11.9),
          turbopack: at(12.2),
          hono: at(13.95),
          express: at(14.25),
          nodejs: at(14.8),
          mdx: at(16.2),
          rust: at(17.25),
        },
        bars: FILM_SCENES.frameworks.bars,
      }}
    />,
  ],
  ["fast", <Rust key="fast" bars={FILM_SCENES.fast.bars} />],
  ["agent", <Agent key="agent" />],
  [
    "claim",
    <FilmClaim
      key="claim"
      cues={{
        fastest: at(0.4),
        complete: at(3),
        proven: at(4.5),
        bars: FILM_SCENES.claim.bars,
      }}
    />,
  ],
  [
    "end",
    <End
      key="end"
      cues={{ domain: at(4.4), release: at(1), note: at(1.9), bars: 4, company: at(6) }}
    />,
  ],
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
