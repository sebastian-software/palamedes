import { plural, t } from "@palamedes/core/macro"

export function renderHomePage(locale: string | undefined): string {
  const seatCount = 3
  const title = t`Remix v3 is rendering ${locale ?? "en"} with Palamedes`
  const seats = plural(seatCount, { one: "# seat left", other: "# seats left" })
  const description = t`This response was translated inside a request-scoped Remix handler.`

  return `<!doctype html>
<html lang="${escapeHtml(locale ?? "en")}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 3rem; line-height: 1.5; }
      main { max-width: 42rem; }
      code { background: #eef2f7; border-radius: 4px; padding: 0.125rem 0.25rem; }
    </style>
  </head>
  <body>
    <main>
      <p><code>@palamedes/remix</code></p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
      <p>${escapeHtml(seats)}</p>
    </main>
  </body>
</html>`
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}
