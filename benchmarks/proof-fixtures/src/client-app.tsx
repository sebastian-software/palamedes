import { t } from "@palamedes/core/macro"
import { Trans } from "@palamedes/react/macro"

export function ClientApp({ name }: { name: string }) {
  const welcome = t`Welcome ${name}`

  return (
    <main>
      <h1>{welcome}</h1>
      <p>
        <Trans>This fixture exercises translated JSX output in a client-oriented component.</Trans>
      </p>
    </main>
  )
}
