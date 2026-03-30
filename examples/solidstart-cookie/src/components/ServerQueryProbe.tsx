import { createSignal } from "solid-js"
import { Trans } from "@palamedes/solid/macro"
import { syncClientI18n, type Locale } from "../lib/i18n"
import { getLocalizedServerStatus } from "../lib/server"

interface ServerQueryResult {
  locale: Locale
  localeLabel: string
  handledAt: string
  message: string
}

interface ServerQueryProbeProps {
  locale: Locale
}

export function ServerQueryProbe(props: ServerQueryProbeProps) {
  syncClientI18n(props.locale)
  const [result, setResult] = createSignal<ServerQueryResult | null>(null)
  const [isPending, setIsPending] = createSignal(false)

  async function refresh() {
    setIsPending(true)
    try {
      setResult(await getLocalizedServerStatus())
    } finally {
      setIsPending(false)
    }
  }

  return (
    <section class="panel">
      <p class="kicker">
        <Trans>Server query proof</Trans>
      </p>
      <h2>
        <Trans>Localized server query result</Trans>
      </h2>
      <p class="muted">
        <Trans>Run the request to fetch a server-localized result.</Trans>
      </p>
      <div class="button-row">
        <button
          class="button"
          data-testid="server-proof-trigger"
          disabled={isPending()}
          onClick={() => void refresh()}
          type="button"
        >
          <Trans>Ask server for localized status</Trans>
        </button>
      </div>
      {result() ? (
        <div class="stats">
          <div>
            <span class="eyebrow">
              <Trans>Server locale</Trans>
            </span>
            <strong>{result()!.localeLabel}</strong>
          </div>
          <div>
            <span class="eyebrow">
              <Trans>Handled at</Trans>
            </span>
            <code>{result()!.handledAt}</code>
          </div>
          <div>
            <span class="eyebrow">
              <Trans>Localized message</Trans>
            </span>
            <strong data-testid="server-proof-message">{result()!.message}</strong>
          </div>
        </div>
      ) : (
        <p class="muted">
          <Trans>Run the request to fetch a server-localized result.</Trans>
        </p>
      )}
    </section>
  )
}
