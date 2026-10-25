import { createFileRoute, Link } from "@tanstack/solid-router";
import { t } from "@palamedes/core/macro";
export const Route = createFileRoute("/details")({
  component: () => (
    <main>
      <h1 data-testid="details-message">{t`Navigation confirmed locale.`}</h1>
      <Link to="/">Home</Link>
    </main>
  ),
});
