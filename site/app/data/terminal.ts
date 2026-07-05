/*
 * Hero terminal-cascade content. Line shapes mirror the real pmds output
 * (crates/palamedes-cli/src/main.rs): extract prints
 * "✓ Extracted N messages from M files (Tms)", audit prints
 * "Catalog audit passed: E error(s), W warning(s), I info" plus grouped
 * diagnostics, and report prints the Locale/Translated/Missing/Complete
 * table. Counts and timings are illustrative; the shapes are not.
 */

export type TerminalTone = "cmd" | "ok" | "warn" | "dim" | "plain"

export interface TerminalLine {
  text: string
  tone: TerminalTone
}

export interface TerminalPanel {
  id: string
  title: string
  lines: TerminalLine[]
}

export const TERMINAL_PANELS: TerminalPanel[] = [
  {
    id: "extract",
    title: "pmds — extract",
    lines: [
      { text: "$ pmds extract", tone: "cmd" },
      { text: "Config loaded from palamedes.yaml", tone: "dim" },
      { text: "Found 312 files to extract from", tone: "dim" },
      { text: "  -> src/locales/en.po", tone: "dim" },
      { text: "  -> src/locales/de.po", tone: "dim" },
      { text: "✓ Extracted 640 messages from 312 files (34ms)", tone: "ok" },
    ],
  },
  {
    id: "audit",
    title: "pmds — audit",
    lines: [
      { text: "$ pmds audit", tone: "cmd" },
      { text: "Catalog audit passed: 0 error(s), 2 warning(s), 0 info", tone: "ok" },
      { text: "src/locales/de.po", tone: "plain" },
      { text: "  [Warning] missing-translation [de]: 28 entries", tone: "warn" },
      { text: "  [Warning] unused-context [de]: 1 entry", tone: "warn" },
    ],
  },
  {
    id: "report",
    title: "pmds — report",
    lines: [
      { text: "$ pmds report --fail-if-below 90", tone: "cmd" },
      { text: "Locale  Translated  Missing  Complete", tone: "dim" },
      { text: "en      640/640     0        100%", tone: "plain" },
      { text: "de      612/640     28       95.6%", tone: "plain" },
      { text: "es      598/640     42       93.4%", tone: "plain" },
      { text: "✓ All locales above threshold", tone: "ok" },
    ],
  },
]

/* Per-locale completeness for the report panel's bar rendering. */
export const REPORT_BARS = [
  { locale: "en", percent: 100 },
  { locale: "de", percent: 95.6 },
  { locale: "es", percent: 93.4 },
]
