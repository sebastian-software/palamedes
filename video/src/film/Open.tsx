import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";

import { SPECIMEN_LOCALES, specimenSeats } from "../../../site/app/data/specimen";
import { C, FONT } from "../brand";
import { ramp } from "../flight/motion";
import { Revealed, steady } from "../kinetic";
import { BAR } from "../timeline";
import { arrive, sceneFade, VersionBadge } from "../ui";
import { at } from "./timeline";

/*
 * Bars 1–2, the prologue: "Your app speaks English. Most of the world
 * doesn't." An English card sits in the middle; then the world answers in
 * its own languages around it. English is spoken by roughly 1.5 of 8 billion
 * people, so the line holds. A quiet lockup in the corner announces the
 * release before the story starts.
 */
const CUE = { card: at(0.3), world: at(2.5), release: 4 };
const ENGLISH = SPECIMEN_LOCALES.find((entry) => entry.locale === "en");

/** "Hello" in other languages, placed around the card (x, y in px, size). */
const GREETINGS = [
  { text: "Hallo", lang: "de", x: 250, y: 210, size: 64 },
  { text: "Hola", lang: "es", x: 1460, y: 180, size: 72 },
  { text: "Bonjour", lang: "fr", x: 180, y: 770, size: 58 },
  { text: "こんにちは", lang: "ja", x: 1380, y: 800, size: 60 },
  { text: "مرحبا", lang: "ar", x: 760, y: 120, size: 56 },
  { text: "Olá", lang: "pt", x: 1640, y: 470, size: 54 },
  { text: "Ciao", lang: "it", x: 110, y: 470, size: 52 },
  { text: "नमस्ते", lang: "hi", x: 820, y: 880, size: 54 },
  { text: "안녕하세요", lang: "ko", x: 470, y: 920, size: 46 },
  { text: "Merhaba", lang: "tr", x: 1180, y: 940, size: 44 },
  { text: "你好", lang: "zh", x: 1120, y: 110, size: 52 },
  { text: "Cześć", lang: "pl", x: 560, y: 250, size: 42 },
] as const;

export function Open() {
  const frame = useCurrentFrame();
  const recede = ramp(frame, CUE.world, CUE.world + 30);

  return (
    <AbsoluteFill style={{ background: C.mist, opacity: sceneFade(frame, BAR * 2, 6), ...steady }}>
      {GREETINGS.map((greeting, index) => (
        <span
          key={greeting.lang}
          lang={greeting.lang}
          style={{
            position: "absolute",
            left: greeting.x,
            top: greeting.y,
            fontFamily: FONT.sans,
            fontSize: greeting.size,
            fontWeight: 500,
            color: index % 3 === 0 ? C.bronze : C.ink,
            opacity: 0.85,
          }}
        >
          <Revealed text={greeting.text} frame={frame} at={CUE.world + index * 2} blur={14} />
        </span>
      ))}

      <div
        style={{
          position: "absolute",
          left: 72,
          top: 60,
          display: "flex",
          alignItems: "center",
          gap: 18,
          ...arrive(frame, CUE.release, 16, 12),
        }}
      >
        <Img src={staticFile("logo.svg")} style={{ width: 46, height: 46 }} />
        <span
          style={{
            fontFamily: FONT.display,
            fontSize: 26,
            letterSpacing: "0.28em",
            color: C.ink,
          }}
        >
          PALAMEDES
        </span>
        <VersionBadge size={20} />
      </div>

      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: 760,
            padding: "46px 52px",
            border: `1.5px solid ${C.hair}`,
            background: C.white,
            transform: `scale(${1 - 0.06 * recede})`,
            ...arrive(frame, CUE.card, 16, 24),
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: FONT.mono,
              fontSize: 18,
              letterSpacing: "0.14em",
              color: C.slate,
            }}
          >
            EN · YOUR APP
          </p>
          <p
            style={{
              margin: "22px 0 0",
              fontFamily: FONT.sans,
              fontSize: 54,
              fontWeight: 700,
              color: C.ink,
            }}
          >
            {ENGLISH?.title}
          </p>
          <p
            style={{
              display: "inline-block",
              margin: "24px 0 0",
              padding: "10px 18px",
              border: `2px solid ${C.bronze}`,
              fontFamily: FONT.sans,
              fontSize: 28,
              color: C.bronze,
            }}
          >
            {ENGLISH ? specimenSeats(ENGLISH, 3) : ""}
          </p>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
