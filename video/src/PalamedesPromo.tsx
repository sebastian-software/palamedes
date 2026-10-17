import { AbsoluteFill, Sequence } from "remotion";
import type { ComponentType } from "react";

import { C } from "./brand";
import { Claim, DEFAULT_CLAIM, type ClaimTiming } from "./scenes/Claim";
import { End } from "./scenes/End";
import { Hook } from "./scenes/Hook";
import { Journey } from "./scenes/Journey";
import { Meet } from "./scenes/Meet";
import { Rust } from "./scenes/Rust";
import { Speak } from "./scenes/Speak";
import { Wiring } from "./scenes/Wiring";
import { SCENES } from "./timeline";
import { useBrandFonts } from "./ui";

/*
 * The promo film, muted: picture only. Voice and score are built outside
 * Remotion (see audio/) and muxed afterwards, so a render stays deterministic.
 */
const PARTS: ReadonlyArray<readonly [keyof typeof SCENES, ComponentType]> = [
  ["hook", Hook],
  ["meet", Meet],
  ["speak", Speak],
  ["journey", Journey],
  ["wiring", Wiring],
  ["rust", Rust],
  ["claim", Claim],
  ["end", End],
];

export interface PromoProps {
  /** Claim word timings from the cue sheet; see audio/cues/promo.json. */
  claim?: ClaimTiming;
}

export function PalamedesPromo({ claim = DEFAULT_CLAIM }: PromoProps) {
  useBrandFonts();
  return (
    <AbsoluteFill style={{ background: C.mist }}>
      {PARTS.map(([key, Scene]) => (
        <Sequence
          key={key}
          from={SCENES[key].from}
          durationInFrames={SCENES[key].to - SCENES[key].from}
          name={key}
        >
          {key === "claim" ? <Claim timing={claim} /> : <Scene />}
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
