import { useEffect, useRef, useState } from "react"

import { REPORT_BARS, TERMINAL_PANELS, type TerminalLine } from "~/data/terminal"
import { useInView } from "~/hooks/useInView"
import { usePrefersReducedMotion } from "~/hooks/usePrefersReducedMotion"

const TONE_CLASSES: Record<TerminalLine["tone"], string> = {
  cmd: "text-paper",
  ok: "text-term-ok",
  warn: "text-term-warn",
  dim: "text-gray-spec",
  plain: "text-paper/85",
}

const LINE_INTERVAL_MS = 220

/*
 * The V7 "CLI and repo ownership" hero visual inside the Swiss system:
 * three overlapping ink panels replaying pmds extract → audit → report.
 * Prerender/no-JS/reduced-motion state: all lines visible, no cursor.
 */
export function TerminalCascade() {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref)
  const reducedMotion = usePrefersReducedMotion()
  const totalLines = TERMINAL_PANELS.reduce((sum, panel) => sum + panel.lines.length, 0)
  const [visibleLines, setVisibleLines] = useState(totalLines)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => setHydrated(true), [])

  useEffect(() => {
    if (!hydrated || reducedMotion || !inView) {
      return
    }
    setVisibleLines(0)
    const timer = setInterval(() => {
      setVisibleLines((count) => {
        if (count >= totalLines) {
          clearInterval(timer)
          return count
        }
        return count + 1
      })
    }, LINE_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [hydrated, reducedMotion, inView, totalLines])

  let lineOffset = 0

  return (
    <div
      ref={ref}
      className="relative"
      role="img"
      aria-label="pmds CLI workflow: extract, audit, report"
    >
      {TERMINAL_PANELS.map((panel, panelIndex) => {
        const start = lineOffset
        lineOffset += panel.lines.length
        const isLast = panelIndex === TERMINAL_PANELS.length - 1
        return (
          <div
            key={panel.id}
            className={`border border-hair bg-ink ${panelIndex > 0 ? "-mt-3 ml-6 max-tight:ml-3" : ""}`}
            style={{ position: "relative", zIndex: panelIndex }}
          >
            <div className="flex items-center gap-2 border-b border-paper/15 px-4 py-2">
              <span className="block size-2 border border-paper/40" />
              <span className="block size-2 border border-paper/40" />
              <span className="block size-2 border border-paper/40" />
              <span className="micro ml-2 text-[10px] text-gray-spec">{panel.title}</span>
            </div>
            <pre className="overflow-x-auto px-4 py-3 font-mono text-[12px] leading-[1.75]">
              {panel.lines.map((line, i) => {
                const globalLineNo = start + i
                const shown = globalLineNo < visibleLines
                const isCursorLine = globalLineNo === visibleLines - 1 && visibleLines < totalLines
                return (
                  <div
                    key={`${panel.id}:${line.text}`}
                    className={`${TONE_CLASSES[line.tone]} transition-opacity duration-150`}
                    style={{ opacity: shown ? 1 : 0 }}
                  >
                    {line.text}
                    {isCursorLine ? (
                      <span
                        className="ml-0.5 inline-block h-[1em] w-[0.55em] translate-y-[0.15em] bg-term-ok"
                        style={{ animation: "cursor-blink 1s step-end infinite" }}
                      />
                    ) : null}
                  </div>
                )
              })}
              {isLast && visibleLines >= totalLines ? (
                <div className="mt-2 space-y-1" aria-hidden>
                  {REPORT_BARS.map((bar) => (
                    <div key={bar.locale} className="flex items-center gap-2">
                      <span className="w-6 text-[11px] text-gray-spec">{bar.locale}</span>
                      <span className="relative h-[8px] w-40 max-w-full border border-paper/25">
                        <span
                          className="absolute inset-y-0 left-0 bg-term-ok"
                          style={{ width: `${bar.percent}%` }}
                        />
                      </span>
                      <span className="mono-nums text-[11px] text-paper/85">{bar.percent}%</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </pre>
          </div>
        )
      })}
    </div>
  )
}
