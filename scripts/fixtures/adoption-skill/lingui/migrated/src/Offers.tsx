import { t, plural } from "@palamedes/core/macro";
import { Trans } from "@palamedes/react/macro";
import { checkoutLabel } from "./labels";

export function Offers({ count, name }: { count: number; name: string }) {
  return (
    <section>
      <h2>{t({ message: "Offers" })}</h2>
      <p>
        <Trans>Hello {name}</Trans>
      </p>
      <p>{plural(count, { one: "# offer", other: "# offers" })}</p>
      <button type="button">{checkoutLabel()}</button>
      <p>{t({ message: "Open", context: "menu" })}</p>
      <p>{t({ message: "Open", context: "status" })}</p>
    </section>
  );
}
