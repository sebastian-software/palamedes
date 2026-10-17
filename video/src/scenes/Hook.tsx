import { Fragment } from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

import { C, FONT } from "../brand";
import { BAR, BEAT } from "../timeline";
import { Revealed } from "../kinetic";
import { arrive, Display, ease, Listing, Mark, Tag } from "../ui";

/*
 * Bars 1–4: the familiar problem. A component reads like a lookup table, a
 * language file per locale stacks up, and glue files pile in beside them —
 * then everything tightens into a crowded, tilted mess before the reveal.
 */
const LOCALES = ["en.json", "de.json", "es.json", "fr.json", "ja.json"];
const KEY_COMMENT = "// …which text was that again?";
const GLUE = [
  "load-messages.server.ts",
  "provider.client.tsx",
  "locale-middleware.ts",
  "hydrate-catalog.ts",
];

/** Scene frames at which each part arrives; the defaults follow the promo's voice. */
export interface HookCues {
  title: number;
  listing: number;
  files: number;
  glue: number;
  crowd: number;
  bars: number;
}

export const PROMO_HOOK: HookCues = {
  title: Math.round(BEAT * 3.4),
  listing: 145,
  files: 205,
  glue: 262,
  crowd: 288,
  bars: 4,
};

export function Hook({ cues = PROMO_HOOK }: { cues?: HookCues }) {
  const frame = useCurrentFrame();
  // Cues follow the voice: keys, then files, then glue, then the crowd.
  const crowd = ease(frame, cues.crowd, 40);
  const fadeOut = interpolate(frame, [BAR * (cues.bars - 0.2), BAR * cues.bars], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: C.mist, opacity: fadeOut }}>
      <div style={{ position: "absolute", left: 140, top: 110 }}>
        <Display size={78}>
          <Revealed text="Adding a second language is easy." frame={frame} at={4} />
        </Display>
      </div>
      <div
        style={{
          position: "absolute",
          left: 140,
          top: 210,
        }}
      >
        <Display size={78} style={{ color: C.bronze }}>
          <Revealed text="Living with it is the hard part." frame={frame} at={cues.title} />
        </Display>
      </div>

      <div
        style={{
          position: "absolute",
          left: 140,
          top: 380,
          width: 880,
          transform: `rotate(${-1.5 * crowd}deg) scale(${1 - 0.04 * crowd})`,
          ...arrive(frame, cues.listing),
        }}
      >
        <Listing
          label="src/TripCard.tsx — a key for every text"
          lines={[
            <Fragment key="title">
              {"<h3>{t("}
              <Mark>"trip.title"</Mark>
              {")}</h3>"}
            </Fragment>,
            <Fragment key="seats">
              {"<p>{t("}
              <Mark>"trip.seats"</Mark>
              {", { count: seats })}</p>"}
            </Fragment>,
            <Fragment key="button">
              {"<button>{t("}
              <Mark>"checkout.cta_v2"</Mark>
              {")}</button>"}
            </Fragment>,
            <Tag key="comment">{KEY_COMMENT}</Tag>,
          ]}
        />
      </div>

      {LOCALES.map((file, index) => {
        const start = cues.files + index * (BEAT / 3);
        const drift = crowd * (index - 2) * 18;
        return (
          <div
            key={file}
            style={{
              position: "absolute",
              left: 1100 + index * 34 + drift,
              top: 360 + index * 70,
              width: 600,
              padding: "20px 26px",
              border: `1.5px solid ${C.hair}`,
              background: C.paper,
              fontFamily: FONT.mono,
              fontSize: 22,
              color: C.ink,
              transform: `rotate(${(index - 2) * 1.6 * crowd}deg)`,
              ...arrive(frame, start, 12, 30),
            }}
          >
            <span style={{ color: C.slate }}>locales/{file}</span>
            <br />
            {'"trip.title": '}
            {index === 3 ? <Mark>missing</Mark> : '"…"'}
          </div>
        );
      })}

      {GLUE.map((file, index) => {
        const start = cues.glue + index * (BEAT / 3);
        return (
          <div
            key={file}
            style={{
              position: "absolute",
              left: 160 + (index % 2) * 450 + crowd * (index - 1.5) * 26,
              top: 760 + Math.floor(index / 2) * 92,
              padding: "16px 24px",
              border: `1.5px dashed ${C.slate}`,
              background: C.listing,
              fontFamily: FONT.mono,
              fontSize: 22,
              color: C.slate,
              transform: `rotate(${(index % 2 ? 1 : -1) * 1.2 * crowd}deg)`,
              ...arrive(frame, start, 12, 26),
            }}
          >
            {file}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
