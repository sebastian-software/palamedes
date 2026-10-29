import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { type IntegrationMark, ROWS } from "../scenes/Wiring";
import { count, Label, Mono, snap, snapIn, Stage } from "./parts";
import { GLUE_LINES } from "./story";
import { cue, SCENES, WORDS } from "./timeline";

/*
 * Bars 22–27: "And there's no glue code to write. The wiring for React, Vue,
 * Svelte, Solid and the frameworks around them is already built." The glue
 * count from the pains rolls down to zero, then the integrations snap in:
 * the four UI libraries as the voice names them, the frameworks and the rest
 * on the sixteenths after "frameworks". Marks are the site's assets at their
 * own proportions, always with the name.
 */
const LENGTH = SCENES.stack.to - SCENES.stack.from;
const ZERO = cue(WORDS.noGlue, "stack");
const LIBRARIES = ROWS[0]?.flatMap((group) => group.marks) ?? [];
const HOSTS = ROWS.slice(1).flatMap((row) => row.flatMap((group) => group.marks));
const LIBRARY_CUES: Readonly<Record<string, number>> = {
  react: cue(WORDS.react, "stack"),
  vue: cue(WORDS.vue, "stack"),
  svelte: cue(WORDS.svelte, "stack"),
  solid: cue(WORDS.solid, "stack"),
};
const HOSTS_FROM = cue(WORDS.frameworks, "stack");
const MOVE = { from: cue(WORDS.react, "stack") - 14, frames: 10 };

function Mark({ mark, scale, size }: { mark: IntegrationMark; scale: number; size: number }) {
  return (
    <div style={{ display: "grid", justifyItems: "center", gap: size * 0.28 }}>
      <div style={{ height: 34 * scale, display: "grid", placeItems: "center" }}>
        <Img
          src={staticFile(`logos/${mark.asset}`)}
          style={{ width: mark.w * scale, height: mark.h * scale }}
        />
      </div>
      <span
        style={{
          fontFamily: FONT.sans,
          fontSize: size,
          fontWeight: 600,
          color: C.ink,
          whiteSpace: "nowrap",
        }}
      >
        {mark.name}
      </span>
    </div>
  );
}

export function Stack() {
  const frame = useCurrentFrame();
  const moved = snap(frame, MOVE.from, MOVE.frames);
  const glue = count(frame, ZERO - 6, 16, GLUE_LINES, 0);
  return (
    <Stage length={LENGTH} ground={C.paper}>
      {/* The glue counter: huge and centred, then parked at the top. */}
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          top: interpolate(moved, [0, 1], [300, 70]),
          display: "flex",
          justifyContent: "center",
          alignItems: "baseline",
          gap: 30,
          transform: `scale(${1 - 0.55 * moved})`,
          transformOrigin: "center top",
        }}
      >
        <Mono size={300} color={glue === 0 ? C.ink : C.bronze} style={{ lineHeight: 1 }}>
          {glue}
        </Mono>
        <span
          style={{
            fontFamily: FONT.display,
            fontSize: 84,
            color: C.ink,
            opacity: snap(frame, ZERO + 2),
          }}
        >
          lines of glue code
        </span>
      </div>

      <AbsoluteFill style={{ top: 300, alignItems: "center", gap: 70, opacity: moved }}>
        <div style={{ display: "flex", gap: 130 }}>
          {LIBRARIES.map((mark) => (
            <div
              key={mark.id}
              style={snapIn(frame, LIBRARY_CUES[mark.id] ?? HOSTS_FROM, { y: 40, s: 1.25 })}
            >
              <Mark mark={mark} scale={4.2} size={48} />
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "44px 70px",
            maxWidth: 1600,
          }}
        >
          {HOSTS.map((mark, index) => (
            <div key={mark.id} style={snapIn(frame, HOSTS_FROM + index * 4, { y: 30, s: 1.2 })}>
              <Mark mark={mark} scale={2.1} size={28} />
            </div>
          ))}
        </div>
        <Label style={{ fontSize: 26, opacity: snap(frame, cue(WORDS.built, "stack")) }}>
          each with a working example in the repository
        </Label>
      </AbsoluteFill>
    </Stage>
  );
}
