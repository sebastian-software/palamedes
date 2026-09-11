function renderCatalogFailure(): void {
  const main = document.createElement("main");
  main.dataset.testid = "catalog-error";
  main.setAttribute("role", "alert");
  const heading = document.createElement("h1");
  heading.textContent = "Translations are temporarily unavailable";
  const message = document.createElement("p");
  message.textContent = "The page could not load its executable translation catalog.";
  const reload = document.createElement("button");
  reload.dataset.testid = "catalog-error-reload";
  reload.type = "button";
  reload.textContent = "Reload";
  reload.addEventListener("click", () => window.location.reload());
  main.append(heading, message, reload);
  document.body.replaceChildren(main);
}

window.addEventListener(
  "error",
  (event) => {
    const target = event.target;
    const assetUrl = event instanceof ErrorEvent ? event.filename : "";
    if (
      (target instanceof HTMLScriptElement &&
        target.src.includes("/assets/app/public/client.tsx")) ||
      /\/assets\/(?:app\/public\/client\.tsx|__palamedes\/catalog-fragments\/)/u.test(assetUrl)
    ) {
      renderCatalogFailure();
    }
  },
  true,
);
