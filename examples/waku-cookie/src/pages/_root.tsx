import type { ReactNode } from "react"

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{`
          html, body { margin: 0; padding: 0; font-family: "Iowan Old Style", "Palatino Linotype", serif; background: linear-gradient(180deg, #f8fafc 0%, #eff6ff 100%); color: #172554; }
          .page-shell { max-width: 72rem; margin: 0 auto; padding: 3rem 1.5rem 4rem; }
          .hero, .panel { border: 1px solid rgba(37, 99, 235, 0.16); background: rgba(255,255,255,0.92); border-radius: 1.25rem; box-shadow: 0 1.5rem 4rem rgba(15,23,42,0.08); }
          .hero { padding: 2rem; }
          .panel { padding: 1.25rem; }
          .grid { display: grid; gap: 1rem; margin-top: 1.5rem; }
          .cols-2 { grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); }
          .button-row { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 1rem; }
          .button, .chip { display: inline-flex; align-items: center; justify-content: center; padding: 0.75rem 1.1rem; border-radius: 999px; border: none; background: #dbeafe; color: #1d4ed8; text-decoration: none; cursor: pointer; font: inherit; }
          .chip.active { background: #1d4ed8; color: white; }
          .kicker, .eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.75rem; color: #1d4ed8; }
          .muted { color: #475569; }
          .stats { display: grid; gap: 0.75rem; margin-top: 1rem; }
          code { word-break: break-word; }
        `}</style>
      </head>
      <body>{children}</body>
    </html>
  )
}
