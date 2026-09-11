import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { plural, t } from "@palamedes/core/macro";
import { Trans } from "@palamedes/react/macro";
import { EVENT } from "@palamedes/example-ui";
import type { Locale } from "../lib/i18n";
import { getLocalizedServerStatus } from "../lib/server-functions";

const LazyFeature = lazy(() => import("./LazyFeature"));

class LazyFeatureBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  public state = { error: null as Error | null };

  public static getDerivedStateFromError(error: Error) {
    return { error };
  }

  public render() {
    if (this.state.error) {
      return (
        <main role="alert" data-testid="lazy-feature-error">
          <h4>Unable to load this feature.</h4>
          <p>Reload the page to try again.</p>
          <button
            className="cta"
            data-testid="lazy-feature-reload"
            onClick={() => window.location.reload()}
            type="button"
          >
            Reload page
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}

type ProofPanelProps = {
  locale: Locale;
};

export function ProofPanel({ locale }: ProofPanelProps) {
  const when = new Date(EVENT.startsAt);
  const seats = EVENT.seatsLeft;
  const [messages, setMessages] = useState<Record<string, string> | null>(null);
  const [showLazyFeature, setShowLazyFeature] = useState(false);
  const [isPending, startTransition] = useTransition();

  function refresh() {
    startTransition(async () => {
      const result = await getLocalizedServerStatus();
      setMessages(result.messages);
    });
  }

  useEffect(() => {
    refresh();
  }, [locale]);

  return (
    <aside className="aside">
      <div className="aside-head">
        <h3>
          <Trans>Behind the scenes</Trans>
        </h3>
        <span>
          <Trans>one switch, every format</Trans>
        </span>
      </div>

      <div className="feat">
        <div className="feat-row">
          <span className="feat-name">
            <Trans>Plural</Trans>
          </span>
          <span className="feat-out">
            {plural(seats, { one: "# seat left", other: "# seats left" })}
          </span>
        </div>
        <code>{`plural(seats, { one: "# seat left", other: "# seats left" })`}</code>
      </div>

      <div className="feat">
        <div className="feat-row">
          <span className="feat-name">
            <Trans>Lazy feature</Trans>
          </span>
          <button
            className="cta"
            data-testid="lazy-feature-trigger"
            onClick={() => setShowLazyFeature(true)}
            type="button"
          >
            <Trans>Open lazy feature</Trans>
          </button>
        </div>
        {showLazyFeature ? (
          <LazyFeatureBoundary>
            <Suspense fallback={<span data-testid="lazy-feature-loading">…</span>}>
              <LazyFeature />
            </Suspense>
          </LazyFeatureBoundary>
        ) : null}
      </div>

      <div className="feat">
        <div className="feat-row">
          <span className="feat-name">
            <Trans>Currency</Trans>
          </span>
          <span className="feat-out">
            {t({ message: "{amount, number, ::currency/EUR}" }, { amount: EVENT.ticketPrice })}
          </span>
        </div>
        <code>{`{amount, number, ::currency/EUR}`}</code>
      </div>

      <div className="feat">
        <div className="feat-row">
          <span className="feat-name">
            <Trans>Number</Trans>
          </span>
          <span className="feat-out">
            {t({ message: "{count, number}" }, { count: EVENT.attendeeCount })}
          </span>
        </div>
        <code>{`{count, number}`}</code>
      </div>

      <div className="feat">
        <div className="feat-row">
          <span className="feat-name">
            <Trans>Date</Trans>
          </span>
          <span className="feat-out is-text">
            {t({ message: "{when, date, medium}" }, { when })}
          </span>
        </div>
        <code>{`{when, date, medium}`}</code>
      </div>

      <div className="feat">
        <div className="feat-row">
          <span className="feat-name">
            <Trans>Server</Trans>
          </span>
          <div className="feat-out is-text">
            <span data-testid="server-proof-message">{messages?.direct ?? "…"}</span>
            <span data-testid="server-proof-sync" hidden>
              {messages?.synchronous ?? ""}
            </span>
            <span data-testid="server-proof-async" hidden>
              {messages?.asynchronous ?? ""}
            </span>
            <span data-testid="server-proof-cross-module" hidden>
              {messages?.crossModule ?? ""}
            </span>
          </div>
        </div>
        <button
          className="cta"
          data-testid="server-proof-trigger"
          disabled={isPending}
          onClick={refresh}
          type="button"
        >
          <Trans>Refresh server result</Trans>
        </button>
      </div>
    </aside>
  );
}
