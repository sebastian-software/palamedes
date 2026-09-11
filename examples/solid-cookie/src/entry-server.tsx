import { getRequestEvent, renderToStream, useHead } from "@solidjs/web";
import { createComponent } from "solid-js";
import manifest from "virtual:solid-manifest";
import App from "./App";
import Document from "./Document";

type ClientManifestChunk = { file?: string };

function resolveClientEntry(context: { clientEntry?: string }): string | undefined {
  if (context.clientEntry) return context.clientEntry;
  const chunk = manifest["src/entry-client.tsx"] as ClientManifestChunk | undefined;
  if (!chunk?.file) return undefined;
  const base = typeof manifest._base === "string" ? manifest._base : "/";
  return `${base.replace(/\/?$/u, "/")}${chunk.file.replace(/^\/+/, "")}`;
}

function resolveCspNonce(): string | undefined {
  const requestNonce = getRequestEvent()?.request.headers.get("x-csp-nonce");
  if (requestNonce) return requestNonce;
  return typeof process !== "undefined" ? process.env.PALAMEDES_CSP_NONCE : undefined;
}

function Root(props: { clientEntry?: string }) {
  if (props.clientEntry) {
    useHead({
      tag: "script",
      props: {
        "data-solid-entry": "",
        nonce: resolveCspNonce(),
        type: "module",
        src: props.clientEntry,
      },
    });
  }
  return <Document>{createComponent(App, {})}</Document>;
}

export function render(_request: Request, context: { clientEntry?: string }) {
  return renderToStream(() => <Root clientEntry={resolveClientEntry(context)} />, {
    manifest,
    nonce: resolveCspNonce(),
  });
}
