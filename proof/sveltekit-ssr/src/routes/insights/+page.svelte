<script lang="ts">
import { t } from "@palamedes/core/macro";
import { getI18n } from "@palamedes/runtime";
const title = t`Lazy catalog detail loaded.`;
const back = t`Back to booking`;
const locale = getI18n().locale;
</script>

<main class="page-shell">
  <h1 data-testid="insights-title">{title}</h1>
  <a data-testid="booking-link" href={`/?locale=${locale}`}>{back}</a>
</main>
