import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { observeBrowserArtifacts } from "./verify-browser-artifacts.mjs";

function response(body) {
  return {
    ok: () => true,
    headers: () => ({ "content-type": "application/javascript" }),
    url: () => "http://localhost/chunk.js",
    body,
  };
}

it("finishes reading late JavaScript responses before the document can navigate away", async () => {
  const page = new EventEmitter();
  let resolveBody;
  let bodyRead = false;
  page.waitForLoadState = vi.fn(async () => {
    page.emit(
      "response",
      response(
        () =>
          new Promise((resolve) => {
            resolveBody = () => {
              bodyRead = true;
              resolve(Buffer.from("console.log('loaded')"));
            };
          }),
      ),
    );
  });
  const observe = observeBrowserArtifacts(page, { id: "fixture" });
  const navigate = vi.fn();
  const navigation = observe.beforeNavigation().then(navigate);
  await Promise.resolve();
  expect(page.waitForLoadState).toHaveBeenCalledWith("networkidle");
  expect(navigate).not.toHaveBeenCalled();
  resolveBody();
  await navigation;
  expect(bodyRead).toBe(true);
  expect(navigate).toHaveBeenCalledOnce();
});

it("rejects a navigation boundary when a JavaScript body could not be read", async () => {
  const page = new EventEmitter();
  page.waitForLoadState = async () => {};
  const observe = observeBrowserArtifacts(page, { id: "fixture" });
  const failure = new Error("Response body is not available");
  page.emit(
    "response",
    response(() => Promise.reject(failure)),
  );
  await expect(observe.beforeNavigation()).rejects.toBe(failure);
});
