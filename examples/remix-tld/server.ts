import * as http from "node:http";

import { createRequestListener } from "remix/node-fetch-server";

import { assetServer } from "./app/assets.ts";
import { router } from "./app/router.ts";
import { catalogAssetRegistry, remixI18n } from "./app/i18n.ts";

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 4060;

const server = http.createServer(
  createRequestListener(async (request) => {
    try {
      if (new URL(request.url).pathname.startsWith("/assets/")) {
        const fragment = catalogAssetRegistry.serve(request);
        if (fragment) return fragment;
        const catalog = remixI18n.serveClientCatalogAsset(request);
        if (catalog) return catalog;
        return (await assetServer.fetch(request)) ?? new Response("Not Found", { status: 404 });
      }
      return await router.fetch(request);
    } catch (error) {
      if (!request.signal.aborted || error !== request.signal.reason) {
        console.error(error);
      }
      return new Response("Internal Server Error", { status: 500 });
    }
  }),
);

server.listen(port, () => {
  console.log(`Remix v3 Palamedes example listening on http://127.0.0.1:${port}`);
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  server.close(async () => {
    catalogAssetRegistry.close?.();
    await assetServer.close();
    process.exit(0);
  });
  server.closeAllConnections();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
