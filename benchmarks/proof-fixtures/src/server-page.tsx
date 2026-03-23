import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"

export function ServerPage({ localeLabel }: { localeLabel: string }) {
  return (
    <section>
      <h1>{t`Server-rendered proof for ${localeLabel}`}</h1>
      <p>
        <Trans>This benchmark fixture mirrors a server-rendered page entry.</Trans>
      </p>
    </section>
  )
}
