import { t, plural, Trans } from "@lingui/macro";
import { useLingui } from "@lingui/react";
import { checkoutLabel } from "./labels";

export function Offers({ count, name }: { count: number; name: string }) {
  const { i18n } = useLingui();
  return (
    <section>
      <h2>{t({ id: "offers.title", message: "Offers" })}</h2>
      <p>
        <Trans>Hello {name}</Trans>
      </p>
      <p>{plural(count, { one: "# offer", other: "# offers" })}</p>
      <button type="button">{i18n._(checkoutLabel)}</button>
      <p>{t({ id: "menu.open", message: "Open", context: "menu" })}</p>
      <p>{t({ id: "status.open", message: "Open", context: "status" })}</p>
    </section>
  );
}
