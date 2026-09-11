/**
 * Resolve the active locale's initial catalog fragments before React Router
 * hydrates. The server adapter already emitted modulepreload links for the
 * evaluated graph; importing those URLs here turns a network failure into a
 * rejected bootstrap promise that the host can render with its normal error
 * document. Lazy route failures remain React Router route errors.
 */
export async function prepareReactRouterCatalogDelivery(): Promise<void> {
  const urls = [...document.querySelectorAll<HTMLLinkElement>(
    'link[rel="modulepreload"][href*="palamedes-m-"]',
  )].map((link) => new URL(link.href, document.baseURI).href);
  await Promise.all(
    urls.map(async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Catalog fragment request failed (${response.status})`);
      await import(/* @vite-ignore */ url);
    }),
  );
}
