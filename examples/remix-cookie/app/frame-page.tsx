import { t } from "@palamedes/core/macro"
import { Frame } from "remix/ui"
import { renderToStream } from "remix/ui/server"

import type { Locale } from "./i18n.ts"

type FramePageOptions = {
  locale: Locale
  localeLabel: string
  request: Request
}

/**
 * Renders a document with a streamed Remix UI Frame. The frame resolver runs
 * under the document request's Palamedes scope; the route serving the same
 * partial establishes its own equivalent scope for client-initiated reloads.
 */
export function renderFrameDocument({ locale, localeLabel, request }: FramePageOptions) {
  const title = t`Remix v3 is rendering ${locale} with Palamedes`

  return renderToStream(
    <html lang={locale}>
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <title>{title}</title>
      </head>
      <body>
        <main>
          <p>
            <code>@palamedes/remix</code>
          </p>
          <h1>{title}</h1>
          <p>
            Active document locale: <strong>{localeLabel}</strong>
          </p>
          <Frame
            fallback={<p data-palamedes-frame-fallback="true">Loading locale summary…</p>}
            name="locale-summary"
            src="/frames/locale-summary"
          />
        </main>
      </body>
    </html>,
    {
      frameSrc: request.url,
      signal: request.signal,
      resolveFrame(src) {
        const frameUrl = new URL(src, request.url)
        if (frameUrl.pathname !== "/frames/locale-summary") {
          throw new Error(`Unexpected Remix frame source: ${frameUrl.pathname}`)
        }

        return renderFrameContent({ locale, localeLabel })
      },
    }
  )
}

export function renderFrameContent({ locale, localeLabel }: Omit<FramePageOptions, "request">) {
  const description = t`This response was translated inside a request-scoped Remix handler.`

  return renderToStream(
    <section data-palamedes-frame="locale-summary">
      <p>{description}</p>
      <p>
        Active frame locale: <strong>{localeLabel}</strong>
      </p>
      <p>Frame locale code: {locale}</p>
    </section>
  )
}
