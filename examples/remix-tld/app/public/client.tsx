import { EVENT } from "@palamedes/example-ui";
import { createRoot } from "remix/component";

const { ClientProof } = await import("./interactive.tsx");
const container = document.querySelector<HTMLElement>("[data-remix-client-proof]");
if (!container) {
  throw new Error("Missing the server-rendered Remix client proof root.");
}

let count = 1;
let quantity = 1;
let serverMessage: string | undefined;
let refreshing = false;
let serverFailed = false;
let lazyText: string | undefined;
const root = createRoot(container);
const render = () =>
  root.render(
    <ClientProof
      audience="developer"
      count={count}
      locale={container.dataset.remixLocale}
      quantity={quantity}
      serverMessage={serverMessage}
      refreshing={refreshing}
      serverFailed={serverFailed}
      lazyText={lazyText}
      framesHref={container.dataset.remixFramesHref}
    />,
  );

container.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (target.closest('[data-testid="ticket-increase"]')) {
    quantity = Math.min(EVENT.maxQuantity, quantity + 1);
  } else if (target.closest('[data-testid="ticket-decrease"]')) {
    quantity = Math.max(1, quantity - 1);
  } else if (target.closest('[data-testid="client-increment"]')) {
    count += 1;
  } else if (target.closest('[data-testid="client-load-lazy"]')) {
    const { lazyMessage } = await import("./lazy-message.ts");
    lazyText = lazyMessage();
  } else if (target.closest('[data-testid="server-proof-trigger"]')) {
    refreshing = true;
    serverFailed = false;
    render();
    try {
      const framesHref = container.dataset.remixFramesHref ?? "/frames";
      const response = await fetch(framesHref.replace(/\/frames$/u, "/server-status"));
      if (!response.ok) throw new Error("The server locale proof could not be refreshed.");
      const result = (await response.json()) as { message: string };
      serverMessage = result.message;
    } catch {
      serverFailed = true;
    } finally {
      refreshing = false;
      render();
    }
    return;
  } else return;
  render();
});

render();

const ready = document.createElement("span");
ready.dataset.testid = "client-ready";
ready.hidden = true;
document.body.append(ready);
