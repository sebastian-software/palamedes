import type { ReactNode } from "react";

/*
 * A small, dependency-free code figure for marketing pages, set like a printed
 * listing. Source code sits on the cool listing ground; text files such as PO
 * catalogs sit on paper. `marks` names the fragments a reader should notice
 * (the sentence, the generated ID); they are set in bronze. Lines that start
 * with a comment or a PO reference are dimmed.
 */

function segments(text: string, pattern: RegExp) {
  let at = 0;
  return text.split(pattern).map((part) => {
    const segment = { part, at };
    at += part.length;
    return segment;
  });
}

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function renderLine(line: string, pattern: RegExp | null): ReactNode {
  const dim = /^\s*(\/\/|#)/u.test(line);
  if (dim) {
    return <span className="text-gray-spec">{line}</span>;
  }
  if (!pattern) return line;
  return segments(line, pattern)
    .filter(({ part }) => part)
    .map(({ part, at }) =>
      pattern.test(part) ? (
        <span key={at} className="font-semibold text-accent">
          {part}
        </span>
      ) : (
        <span key={at}>{part}</span>
      ),
    );
}

export function CodeBlock({
  label,
  code,
  marks = [],
  tone = "code",
  caption,
}: {
  label: string;
  code: string;
  marks?: readonly string[];
  tone?: "code" | "file";
  caption?: ReactNode;
}) {
  const pattern =
    marks.length > 0 ? new RegExp(`(${marks.map(escapeForPattern).join("|")})`, "u") : null;
  const lines = code.split("\n").map((text, index) => ({ no: index + 1, text }));

  return (
    <figure className={tone === "code" ? "pmds-code" : "border border-hair bg-paper text-ink"}>
      <p className="pmds-code-label micro px-5 py-3 text-[11px] tracking-label text-slate">
        {label}
      </p>
      <pre
        tabIndex={0}
        role="region"
        aria-label={label}
        className="overflow-x-auto px-5 py-5 font-mono text-[12.5px] leading-[1.75] text-ink/90 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent max-sm:whitespace-pre-wrap max-sm:[overflow-wrap:anywhere]"
      >
        <code>
          {lines.map((line) => (
            <span key={line.no} className="block max-sm:pl-[2ch] max-sm:-indent-[2ch]">
              {line.text ? renderLine(line.text, pattern) : " "}
            </span>
          ))}
        </code>
      </pre>
      {caption ? (
        <figcaption className="border-t border-hair px-5 py-3 text-[13px] leading-relaxed text-ink/70">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
