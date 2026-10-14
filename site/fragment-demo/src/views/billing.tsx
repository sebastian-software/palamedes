import { t } from "@palamedes/core/macro";

export default function Billing() {
  return (
    <>
      <h2>{t`Your plan and billing`}</h2>
      <p>{t`Review the workspace plan before your next renewal.`}</p>
      <dl className="workspace-list">
        <div>
          <dt>{t`Current plan`}</dt>
          <dd>{t`Team workspace`}</dd>
        </div>
        <div>
          <dt>{t`Billing cycle`}</dt>
          <dd>{t`Monthly`}</dd>
        </div>
        <div>
          <dt>{t`Payment status`}</dt>
          <dd>{t`Up to date`}</dd>
        </div>
      </dl>
      <p>{t`Invoices and payment details are available to workspace administrators.`}</p>
    </>
  );
}
