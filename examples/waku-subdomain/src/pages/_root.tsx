import type { ReactNode } from "react"
import "@palamedes/example-ui/styles.css"

// Waku pre-renders this document shell once, so it cannot carry a per-request
// locale. The active locale is applied to `document.documentElement.lang` by
// the client bootstrap in `src/lib/i18n.ts` instead; see the waku section of
// `docs/framework-example-notes.md`.
export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
      </head>
      <body>{children}</body>
    </html>
  )
}
