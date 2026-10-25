import { t } from "@palamedes/core/macro";
import { getI18n } from "@palamedes/runtime";

import { ServerFunctionProof } from "../components/server-function-proof";
import { LocaleSwitcher } from "../components/locale-switcher";

export function meta() {
  return [{ title: "Palamedes React Router RSC Server Function" }];
}

export function ServerComponent() {
  return (
    <main>
      <h1>{t`React Router RSC request scope`}</h1>
      <LocaleSwitcher locale={getI18n().locale} />
      <p data-testid="server-rendered-message">{t`Server render confirmed locale.`}</p>
      <ServerFunctionProof />
    </main>
  );
}
