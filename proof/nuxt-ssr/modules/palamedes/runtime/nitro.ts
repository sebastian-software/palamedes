import { Readable } from "node:stream";
import { defineNitroPlugin } from "nitropack/runtime";
import { createViteCatalogDelivery } from "@palamedes/vite-plugin/delivery";
import bindings from "#palamedes/catalog-bindings";

// Bindings are embedded at build time; deployed output has no build-directory dependency.
const delivery = createViteCatalogDelivery({ clientDirectory: ".", development: !bindings });

export default defineNitroPlugin((app) => {
  app.hooks.hook("render:response", async (response, { event }) => {
    const locale = event.context.palamedesLocale;
    if (!locale || typeof response.body !== "string" || !response.body.includes("</head>")) return;
    const binding = bindings?.[locale] ?? null;
    const stream = Readable.from([response.body]).pipe(delivery.createDocumentTransform(binding));
    let html = "";
    for await (const chunk of stream) html += chunk.toString();
    response.body = html;
  });
});
