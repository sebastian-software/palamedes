import { t } from "@palamedes/core/macro";
import { Plural, Trans } from "@palamedes/react/macro";

export default function Overview() {
  return (
    <>
      <h2>{t`Your workspace at a glance`}</h2>
      <p>
        <Trans>
          Welcome back, <strong>Alex</strong>. Here is what needs your attention.
        </Trans>
      </p>
      <dl className="workspace-stats">
        <div>
          <dt>{t`Active projects`}</dt>
          <dd>3</dd>
        </div>
        <div>
          <dt>{t`Team members`}</dt>
          <dd>8</dd>
        </div>
      </dl>
      <p>
        <Plural value={2} one="# task is due today." other="# tasks are due today." />
      </p>
      <p>{t`Open Projects to review the work, or Billing to check your plan.`}</p>
    </>
  );
}
