import { useEffect, useRef, useState } from "ardo/react";
import { enableAnalytics } from "~/lib/analytics-bootstrap";
import { installInteractions, trackEvent } from "~/lib/analytics";

export function FragmentDemo() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(1500);
  useEffect(() => {
    const updateHeight = (nextHeight: unknown) => {
      if (
        typeof nextHeight === "number" &&
        Number.isFinite(nextHeight) &&
        nextHeight >= 200 &&
        nextHeight <= 5000
      )
        setHeight(Math.ceil(nextHeight) + 2);
    };
    const resize = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow) return;
      if (event.data?.type !== "palamedes:demo-height") return;
      updateHeight(event.data.height);
    };
    let uninstall = () => {};
    const observe = () => {
      uninstall();
      const doc = frame.current?.contentDocument;
      if (!doc || !enableAnalytics()) return;
      uninstall = installInteractions(doc, (name, properties) =>
        trackEvent("demo_interaction", {
          ...properties,
          action: name,
          placement: "fragment-demo",
          locale: doc.documentElement.lang,
        }),
      );
    };
    const element = frame.current;
    element?.addEventListener("load", observe);
    observe();
    window.addEventListener("message", resize);
    // Prerendered iframe content can finish before the parent hydrates.
    updateHeight(
      frame.current?.contentDocument?.getElementById("root")?.getBoundingClientRect().height,
    );
    return () => {
      uninstall();
      element?.removeEventListener("load", observe);
      window.removeEventListener("message", resize);
    };
  }, []);
  return (
    <>
      {/* oxlint-disable-next-line react/iframe-missing-sandbox -- This is our own compiled app; Resource Timing and resizing require the same origin. */}
      <iframe
        ref={frame}
        src="/fragment-demo/en.html"
        title="Live message splitting demo"
        className="w-full border border-hair"
        style={{ height }}
      />
      <p className="mt-4 text-[13px] text-ink/80">
        JavaScript is required for the interactive demo. You can also{" "}
        <a
          className="text-accent underline"
          href="/fragment-demo/en.html"
          target="_blank"
          rel="noreferrer"
        >
          open it in its own tab
        </a>{" "}
        to follow the fragment requests in your browser's Network panel.
      </p>
    </>
  );
}
