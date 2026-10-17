import type { CSSProperties } from "react";

import {
  enterOffset,
  resolveEasing,
  resolveTextRevealSettings,
  type TextRevealPreset,
} from "@/components/snap-cn/text-reveal";

/*
 * Headlines that arrive the way snapcn's Text Reveal presets do, but inline
 * and in the brand faces: each word (or letter) rises a little, sharpens from
 * a blur and fades in on the preset's curve. Settings come from the vendored
 * component, so the motion matches the library rather than a homemade guess.
 */

/** Type stays steady while it moves or scales: no hinting, no pixel snapping. */
export const steady: CSSProperties = {
  textRendering: "geometricPrecision",
  WebkitFontSmoothing: "antialiased",
};

export function Revealed({
  text,
  frame,
  at,
  preset = "soft-blur-in",
  unit = "word",
  stagger,
  blur = 10,
}: {
  text: string;
  frame: number;
  at: number;
  preset?: TextRevealPreset;
  unit?: "word" | "character";
  stagger?: number;
  blur?: number;
}) {
  const s = resolveTextRevealSettings({ preset });
  const ease = resolveEasing(s.easing);
  const step = stagger ?? (unit === "word" ? 3 : s.stagger);
  const offset = enterOffset(s.direction, s.distance);
  const words = text.split(" ");
  let index = 0;
  return (
    <span style={steady}>
      {words.map((word, w) => {
        const units = unit === "word" ? [word] : [...word];
        return (
          <span
            // Words of a fixed headline never reorder.
            key={`${word}-${w.toString()}`}
            style={{ display: "inline-block", whiteSpace: "nowrap", marginRight: "0.26em" }}
          >
            {units.map((part, u) => {
              const start = at + index * step;
              index += 1;
              const raw = Math.min(1, Math.max(0, (frame - start) / s.enterDuration));
              const t = ease(raw);
              return (
                <span
                  key={`${part}-${u.toString()}`}
                  style={{
                    display: "inline-block",
                    opacity: Math.min(1, raw * 1.6),
                    transform: `translate(${offset.x * (1 - t)}px, ${offset.y * (1 - t)}px)`,
                    filter: raw < 1 ? `blur(${(blur * (1 - t)).toFixed(2)}px)` : undefined,
                  }}
                >
                  {part}
                </span>
              );
            })}
          </span>
        );
      })}
    </span>
  );
}
