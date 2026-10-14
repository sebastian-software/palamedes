import { t } from "@palamedes/core/macro";

export default function Projects() {
  return (
    <>
      <h2>{t`Projects in progress`}</h2>
      <p>{t`Keep the next milestone in sight. Your team can pick up where you left off.`}</p>
      <ul className="workspace-list">
        <li>
          <strong>{t`Website launch`}</strong>
          <span>{t`Ready for review`}</span>
        </li>
        <li>
          <strong>{t`Customer research`}</strong>
          <span>{t`Interviews scheduled`}</span>
        </li>
        <li>
          <strong>{t`Design system`}</strong>
          <span>{t`In progress`}</span>
        </li>
      </ul>
      <p>{t`Project updates stay with the project, so everyone has the same context.`}</p>
    </>
  );
}
