import type { ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { pop } from "../flight/motion";
import { VersionBadge } from "../ui";
import { Caret, Label, Mono, Plus, snap, snapIn, Stage, typedAt } from "./parts";
import { ADDED, BUTTON_SOURCE, FILES, REMOVED } from "./story";
import { cue, SCENES, WORDS } from "./timeline";

/*
 * Bars 11–12, the breakdown: "With Palamedes, your agent just writes the
 * sentence." The agent's key-based line deletes itself and the sentence is
 * written in its place; the bill above rolls back from twelve files to one.
 */
const LENGTH = SCENES.reveal.to - SCENES.reveal.from;
const OLD_LINE = '<button>{t("checkout.cta_v2")}</button>';
const ERASE = { from: 26, to: cue(WORDS.writes, "reveal") - 8 };
const WRITE = { from: cue(WORDS.writes, "reveal") - 6, frames: 22 };
const SETTLE = cue(WORDS.sentence, "reveal") + 4;

/** Bronze for the macro tags. */
function marked(text: string): ReactNode {
  return text.split(/(<\/?Trans>?)/u).map((part, index) =>
    part.startsWith("<Trans") || part.startsWith("</Trans") ? (
      // Parts of one fixed line never reorder.
      <span key={`${part}-${index.toString()}`} style={{ color: C.bronze }}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function Reveal() {
  const frame = useCurrentFrame();
  const erased = interpolate(frame, [ERASE.from, ERASE.to], [OLD_LINE.length, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const line =
    frame < WRITE.from
      ? OLD_LINE.slice(0, Math.round(erased))
      : typedAt(BUTTON_SOURCE, frame, WRITE.from, WRITE.frames);
  const settled = snap(frame, SETTLE, 6);

  return (
    <Stage length={LENGTH} ground={C.mist} push={0.05}>
      <AbsoluteFill style={{ padding: "0 160px", justifyContent: "center" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <Label style={{ fontSize: 30 }}>src/TripCard.tsx</Label>
          <span style={{ position: "relative" }}>
            <Mono size={44} style={{ opacity: 1 - settled }}>
              {FILES} files changed · <Plus>+{ADDED}</Plus> −{REMOVED}
            </Mono>
            <Mono
              size={44}
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                ...snapIn(frame, SETTLE, { y: -20 }),
              }}
            >
              1 file changed · <Plus>+1</Plus> −1
            </Mono>
          </span>
        </div>
        <div
          style={{
            marginTop: 36,
            padding: "60px 56px",
            border: `2.5px solid ${settled ? C.bronze : C.hair}`,
            background: C.listing,
          }}
        >
          <Mono size={64}>
            {marked(line)}
            {frame < SETTLE + 12 ? <Caret frame={frame} /> : null}
          </Mono>
        </div>
      </AbsoluteFill>
    </Stage>
  );
}

/*
 * Bar 13, the drop: the lockup lands on the downbeat, then shrinks into the
 * corner mark that stays through the proof scenes.
 */
const LOCKUP = SCENES.lockup.to - SCENES.lockup.from;
export const CORNER = { right: 56, bottom: 44, size: 44 };

export function Lockup() {
  const frame = useCurrentFrame();
  const land = pop(frame, 0, { damping: 12, stiffness: 180 });
  const leave = snap(frame, LOCKUP - 14, 12);
  const logo = 300;
  const cx = 1920 - CORNER.right - CORNER.size / 2;
  const cy = 1080 - CORNER.bottom - CORNER.size / 2;
  const scale = (1.35 - 0.35 * land) * (1 - leave * (1 - CORNER.size / logo));
  return (
    <Stage length={LOCKUP} ground={C.paper} push={0}>
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            transform: `translate(${(cx - 960) * leave}px, ${(cy - 400) * leave}px) scale(${scale})`,
            position: "absolute",
            left: 960 - logo / 2,
            top: 400 - logo / 2,
          }}
        >
          <Img
            src={staticFile("logo.svg")}
            style={{ width: logo, height: logo, display: "block" }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            top: 600,
            display: "flex",
            alignItems: "center",
            gap: 40,
            opacity: (1 - leave) * snap(frame, 2, 5),
            transform: `scale(${1.2 - 0.2 * land})`,
          }}
        >
          <span
            style={{
              paddingLeft: "0.28em",
              fontFamily: FONT.display,
              fontSize: 110,
              letterSpacing: "0.28em",
              color: C.ink,
            }}
          >
            PALAMEDES
          </span>
          <VersionBadge size={40} />
        </div>
      </AbsoluteFill>
    </Stage>
  );
}
