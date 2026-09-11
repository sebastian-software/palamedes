import { createI18n } from "@palamedes/core";
import { initializeRemixClientI18nAsync } from "@palamedes/remix/client";
import { createRoot } from "remix/ui";

function renderCatalogFailure(error: unknown): void {
  console.error("Palamedes Remix catalog loading failed.", error);
  const main = document.createElement("main");
  main.dataset.testid = "catalog-error";
  main.setAttribute("role", "alert");
  const heading = document.createElement("h1");
  heading.textContent = "Translations are temporarily unavailable";
  const message = document.createElement("p");
  message.textContent = "The page could not load its executable translation catalog.";
  const reload = document.createElement("button");
  reload.type = "button";
  reload.dataset.testid = "catalog-error-reload";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => window.location.reload());
  main.append(heading, message, reload);
  document.body.replaceChildren(main);
}

try {
  const catalogLink = document.querySelector<HTMLLinkElement>(
    "link[data-palamedes-catalog-locale]",
  );
  if (!catalogLink)
    throw new Error("Palamedes Remix catalog preload is missing from the document.");
  await initializeRemixClientI18nAsync({ createI18n, catalogUrl: catalogLink.href });

  const { ClientProof } = await import("./interactive.tsx");
  const container = document.querySelector<HTMLElement>("[data-remix-client-proof]");
  if (!container) {
    throw new Error("Missing the server-rendered Remix client proof root.");
  }

  let count = 1;
  const root = createRoot(container);
  const render = () => root.render(<ClientProof audience="developer" count={count} />);

  container.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-testid="client-increment"]')) {
      return;
    }

    count += 1;
    render();
  });

  render();

  const ready = document.createElement("span");
  ready.dataset.testid = "client-ready";
  ready.hidden = true;
  document.body.append(ready);
} catch (error) {
  renderCatalogFailure(error);
}
