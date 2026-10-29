import type { ReactNode } from "react";
import { AbsoluteFill, Img, Sequence, staticFile, useCurrentFrame } from "remotion";

import { SnapCnUIProvider } from "@/lib/snap-cn-ui";

import { C } from "../brand";
import { steady } from "../kinetic";
import { End } from "../scenes/End";
import { palamedesTheme } from "../snapcn-theme";
import { BAR as FILM_BAR } from "../timeline";
import { useBrandFonts } from "../ui";
import { Check } from "./Check";
import { Fast } from "./Fast";
import { Hook } from "./Hook";
import { Pains } from "./Pains";
import { snap } from "./parts";
import { CORNER, Lockup, Reveal } from "./Reveal";
import { Skill } from "./Skill";
import { Stack } from "./Stack";
import { cue, type LaunchSection, SCENES, WORDS } from "./timeline";

/*
 * The launch cut, muted: picture only. Chris's takes and the deep-house
 * score are mixed outside Remotion from audio/cues/launch.json and muxed
 * afterwards (audio/build-launch.sh). Scenes cut hard on downbeats.
 */
const PARTS: ReadonlyArray<readonly [LaunchSection, ReactNode]> = [
  ["hook", <Hook key="hook" />],
  ["pains", <Pains key="pains" />],
  ["reveal", <Reveal key="reveal" />],
  ["lockup", <Lockup key="lockup" />],
  ["check", <Check key="check" />],
  ["fast", <Fast key="fast" />],
  ["stack", <Stack key="stack" />],
  ["skill", <Skill key="skill" />],
  [
    "end",
    <End
      key="end"
      cues={{
        release: cue(WORDS.version, "end") - 6,
        note: cue(WORDS.version, "end") + 6,
        domain: cue(WORDS.domain, "end"),
        company: cue(WORDS.domain, "end") + 50,
        // End fades out over its last bars, counted in the piano film's bars.
        bars: (SCENES.end.to - SCENES.end.from) / FILM_BAR,
      }}
    />,
  ],
];

export function PalamedesLaunch() {
  useBrandFonts();
  return (
    <SnapCnUIProvider theme={palamedesTheme}>
      <AbsoluteFill style={{ background: C.paper, ...steady }}>
        {PARTS.map(([section, scene]) => (
          <Sequence
            key={section}
            from={SCENES[section].from}
            durationInFrames={SCENES[section].to - SCENES[section].from}
            name={section}
          >
            {scene}
          </Sequence>
        ))}
        <Sequence
          from={SCENES.check.from}
          durationInFrames={SCENES.skill.to - SCENES.check.from}
          name="corner mark"
        >
          <CornerMark length={SCENES.skill.to - SCENES.check.from} />
        </Sequence>
      </AbsoluteFill>
    </SnapCnUIProvider>
  );
}

/** The emblem the lockup shrinks into, kept as a footnote through the proof. */
function CornerMark({ length }: { length: number }) {
  const frame = useCurrentFrame();
  return (
    <Img
      src={staticFile("logo.svg")}
      style={{
        position: "absolute",
        right: CORNER.right,
        bottom: CORNER.bottom,
        width: CORNER.size,
        height: CORNER.size,
        opacity: 1 - snap(frame, length - 6, 6),
      }}
    />
  );
}
