import { Trans } from "@palamedes/react/macro";

export default function LazyFeature() {
  return (
    <section data-testid="lazy-feature">
      <h4>
        <Trans>Lazy translated feature</Trans>
      </h4>
      <p>
        <Trans>This panel was loaded after the page became interactive.</Trans>
      </p>
    </section>
  );
}
