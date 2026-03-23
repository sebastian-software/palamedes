import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { Root, Slot } from 'waku/minimal/client';

const initialRscPath = globalThis.location?.pathname ?? ""

const rootElement = (
  <StrictMode>
    <Root initialRscPath={initialRscPath}>
      <Slot id="App" />
    </Root>
  </StrictMode>
);

if ((globalThis as any).__WAKU_HYDRATE__) {
  hydrateRoot(document, rootElement);
} else {
  createRoot(document).render(rootElement);
}
