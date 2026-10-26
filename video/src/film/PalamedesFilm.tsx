import type { ReactNode } from "react";
import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame } from "remotion";

import { C } from "../brand";
import { JourneyFlight } from "../flight/JourneyFlight";
import { End } from "../scenes/End";
import { Rust } from "../scenes/Rust";
import { Wiring } from "../scenes/Wiring";
import { SnapCnUIProvider } from "@/lib/snap-cn-ui";

import { steady } from "../kinetic";
import { palamedesTheme } from "../snapcn-theme";
import { ease, useBrandFonts } from "../ui";
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
          react: at(2.4),
          solid: at(3.25),
          vue: at(3.9),
          svelte: at(4.4),
          nextjs: at(7.4),
          nuxt: at(8.7),
          sveltekit: at(9.4),
          tanstack: at(10.4),
          "react-router": at(11.35),
          waku: at(12.5),
          remix: at(13.2),
          hono: at(16),
          express: at(16.3),
          nodejs: at(16.9),
          mdx: at(18.25),
          rust: at(19.4),
        },
        bars: FILM_SCENES.frameworks.bars,
      }}
    />,
  ],
  ["fast", <Rust key="fast" bars={FILM_SCENES.fast.bars} start={at(3.8)} />],
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
        <Sequence
          from={FILM_SCENES.journey.from}
          durationInFrames={FILM_SCENES.claim.to - FILM_SCENES.journey.from}
          name="corner mark"
        >
          <CornerMark length={FILM_SCENES.claim.to - FILM_SCENES.journey.from} />
        </Sequence>
      </AbsoluteFill>
    </SnapCnUIProvider>
  );
}

/** The emblem as a small footnote from the journey to the claim, unchanged and alone. */
function CornerMark({ length }: { length: number }) {
  const frame = useCurrentFrame();
  const shown = ease(frame, 12, 18) * (1 - ease(frame, length - 18, 18));
  return (
    <Img
      src={staticFile("logo.svg")}
      style={{ position: "absolute", right: 56, bottom: 44, width: 44, height: 44, opacity: shown }}
    />
  );
}
