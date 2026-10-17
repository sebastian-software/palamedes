import { AbsoluteFill, Img, staticFile } from "remotion";

import { C, FONT } from "./brand";
import { Display, Kicker, useBrandFonts } from "./ui";

/*
 * The poster for the site's "Watch the film" button and video platforms: the
 * promise and the sentence in two languages, with calm space at the lower left
 * where a play label sits.
 */
export function Poster() {
  useBrandFonts();
  return (
    <AbsoluteFill style={{ background: C.mist, padding: "140px 160px" }}>
      <Img
        src={staticFile("logo.svg")}
        style={{
          position: "absolute",
          right: -150,
          top: -110,
          width: 900,
          height: 900,
          opacity: 0.08,
        }}
      />
      <Kicker>Open-source i18n for React, Solid &amp; TypeScript</Kicker>
      <Display size={124} style={{ marginTop: 40 }}>
        Just write
        <br />
        <span style={{ color: C.bronze }}>the sentence.</span>
      </Display>
      <div
        style={{
          position: "absolute",
          right: 160,
          bottom: 150,
          width: 760,
          border: `1.5px solid ${C.hair}`,
          background: C.paper,
        }}
      >
        <p
          style={{
            margin: 0,
            padding: "22px 30px",
            borderBottom: `1.5px solid ${C.hair}`,
            background: C.listing,
            fontFamily: FONT.mono,
            fontSize: 26,
            color: C.ink,
          }}
        >
          <span style={{ color: C.slate }}>{"<Trans>"}</span>
          <span style={{ color: C.bronze, fontWeight: 700 }}>Your trip starts tomorrow.</span>
          <span style={{ color: C.slate }}>{"</Trans>"}</span>
        </p>
        <p
          lang="de"
          style={{
            margin: 0,
            padding: "34px 30px",
            fontFamily: FONT.sans,
            fontSize: 52,
            fontWeight: 500,
            color: C.ink,
          }}
        >
          Deine Reise beginnt morgen.
        </p>
      </div>
    </AbsoluteFill>
  );
}
