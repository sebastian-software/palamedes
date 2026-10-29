import type { CSSProperties, ReactNode } from "react";
import { Img, staticFile } from "remotion";

import { C, FONT } from "../brand";
import type { IntegrationMark } from "../scenes/Wiring";

/*
 * The objects that live in the launch film's space. They carry as little
 * text as the story allows: a file is a name and a few lines of grey, a
 * translation is the word itself, a framework is its mark.
 */
export function File({
  name,
  width = 520,
  bars = [0.8, 0.55, 0.7],
  badge,
  children,
  style,
}: {
  name: string;
  width?: number;
  bars?: readonly number[];
  badge?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div style={{ width, background: C.listing, border: `2px solid ${C.hair}`, ...style }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "12px 20px",
          borderBottom: `2px solid ${C.hair}`,
          background: C.paper,
          fontFamily: FONT.mono,
          fontSize: 22,
          color: C.slate,
          whiteSpace: "nowrap",
        }}
      >
        <span>{name}</span>
        {badge}
      </div>
      <div style={{ padding: "20px 20px 24px", display: "grid", gap: 14 }}>
        {children ??
          bars.map((bar, index) => (
            <div
              key={`bar-${bar}`}
              style={{
                width: `${bar * 100}%`,
                height: 12,
                background: index === 1 ? C.gold : C.mistDeep,
                opacity: index === 1 ? 0.7 : 1,
              }}
            />
          ))}
      </div>
    </div>
  );
}

export const Added = ({ n }: { n: number }) => (
  <span style={{ color: C.bronze, fontWeight: 700 }}>+{n}</span>
);

/** The product's own button, the one the agent was asked to translate. */
export function BookButton({ label = "Book", scale = 1 }: { label?: string; scale?: number }) {
  return (
    <div
      style={{
        padding: `${22 * scale}px ${64 * scale}px`,
        borderRadius: 999,
        background: C.ink,
        color: C.paper,
        fontFamily: FONT.sans,
        fontWeight: 600,
        fontSize: 56 * scale,
        whiteSpace: "nowrap",
        boxShadow: `0 ${18 * scale}px ${40 * scale}px rgba(14, 42, 77, 0.18)`,
      }}
    >
      {label}
    </div>
  );
}

export function Prompt({
  text,
  placeholder,
  caret,
  sendPulse = 0,
  active,
  size = 56,
}: {
  text: ReactNode;
  placeholder?: string;
  caret?: ReactNode;
  sendPulse?: number;
  active: boolean;
  size?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 30,
        padding: `${size * 0.6}px ${size * 0.7}px`,
        border: `2.5px solid ${active ? C.bronze : C.hair}`,
        borderRadius: size * 0.5,
        background: C.white,
        boxShadow: "0 30px 70px rgba(14, 42, 77, 0.10)",
      }}
    >
      <span style={{ fontFamily: FONT.sans, fontSize: size, color: C.ink, whiteSpace: "nowrap" }}>
        {text || <span style={{ color: C.gray }}>{placeholder}</span>}
        {caret}
      </span>
      <span
        style={{
          flex: "none",
          width: size * 1.3,
          height: size * 1.3,
          borderRadius: 999,
          background: C.bronze,
          color: C.white,
          display: "grid",
          placeItems: "center",
          fontFamily: FONT.sans,
          fontSize: size * 0.75,
          transform: `scale(${1 + 0.2 * Math.sin(Math.PI * sendPulse)})`,
        }}
      >
        ↑
      </span>
    </div>
  );
}

/** A framework mark with its name, at film size. */
export function Mark({
  mark,
  scale = 4,
  size = 40,
}: {
  mark: IntegrationMark;
  scale?: number;
  size?: number;
}) {
  return (
    <div style={{ display: "grid", justifyItems: "center", gap: size * 0.4 }}>
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

export function Dot({ size, color, glow = 0 }: { size: number; color: string; glow?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        boxShadow: glow > 0 ? `0 0 ${glow}px ${glow * 0.4}px ${color}` : undefined,
      }}
    />
  );
}
