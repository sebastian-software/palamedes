import { t } from "@palamedes/core/macro"

import { ServerFunctionProof } from "../components/server-function-proof"

export function meta() {
  return [{ title: "Palamedes React Router RSC Server Function" }]
}

export function ServerComponent() {
  return (
    <main>
      <h1>{t`React Router RSC request scope`}</h1>
      <p data-testid="server-rendered-message">{t`Server render confirmed locale.`}</p>
      <ServerFunctionProof />
    </main>
  )
}
