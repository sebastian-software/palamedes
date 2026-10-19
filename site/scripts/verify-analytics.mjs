import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { startSiteStaticServer } from "../../scripts/site-static-server.mjs";

const siteRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = await startSiteStaticServer({
  clientDir: resolve(siteRoot, "build/client"),
  port: Number(process.env.SITE_ANALYTICS_PORT ?? 4118),
});
const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
].find((path) => path && existsSync(path));
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
const origin = "https://palamedes.dev";

// A transport fixture; the installed SDK is also checked during activation.
const sdkFixture = `
window.__events = [];
window.rybbit = {
  event: (name, properties) => window.__events.push({name, properties}),
  pageview: () => window.__events.push({name: 'pageview', properties: {page: location.pathname}}),
};
`;
const playerFixture = `<!doctype html><html><body><p>Player protocol fixture</p><script>
const subscriptions = new Map();
window.emit = (event, value) => {
  const listener = subscriptions.get(event);
  if (listener) parent.postMessage(JSON.stringify({context:'player.js', event, value, listener}), '${origin}');
};
addEventListener('message', ({data}) => {
  const message = JSON.parse(data);
  if (message.method === 'addEventListener') subscriptions.set(message.value, message.listener);
  if (message.method === 'removeEventListener') subscriptions.delete(message.value);
  if (message.method === 'getPaused') parent.postMessage(JSON.stringify({context:'player.js', event:'getPaused', value:false, listener:message.listener}), '${origin}');
});
parent.postMessage(JSON.stringify({context:'player.js', event:'ready'}), '${origin}');
</script></body></html>`;

async function context({ disabled = false, blocked = false, local = false } = {}) {
  const instance = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  let sdkRequests = 0;
  await instance.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().resourceType() === "script" && url.searchParams.has("siteId")) {
      sdkRequests++;
      if (blocked) return route.abort();
      assert.ok(url.searchParams.get("siteId"), "SDK request must carry the configured site ID");
      return route.fulfill({ contentType: "application/javascript", body: sdkFixture });
    }
    if (url.hostname === "palamedes.dev") {
      const response = await route.fetch({ url: `${server.baseUrl}${url.pathname}${url.search}` });
      return route.fulfill({ response });
    }
    if (url.hostname === "player.mediadelivery.net") {
      return route.fulfill({ contentType: "text/html", body: playerFixture });
    }
    if (url.hostname === "127.0.0.1") return route.continue();
    return route.abort();
  });
  if (disabled) await instance.addInitScript(() => localStorage.setItem("disable-rybbit", "true"));
  const page = await instance.newPage();
  await page.goto(local ? server.baseUrl : origin, { waitUntil: "networkidle" });
  return { instance, page, requests: () => sdkRequests };
}

async function events(page, name) {
  return page.evaluate(
    (eventName) => (window.__events ?? []).filter((event) => event.name === eventName),
    name,
  );
}

try {
  const active = await context();
  const { page } = active;
  assert.equal(
    active.requests(),
    1,
    "Build the site with VITE_RYBBIT_SCRIPT_URL and VITE_RYBBIT_SITE_ID before this check (use the test values in site/analytics.md)",
  );
  assert.deepEqual(
    (await events(page, "pageview")).map(({ properties }) => properties.page),
    ["/"],
  );
  await page.evaluate(() => {
    history.pushState(history.state, "", "/?search=private#anchor");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForTimeout(600);
  assert.equal((await events(page, "pageview")).length, 1, "Query/anchor changes aren't visits");
  await page.evaluate(() => {
    history.replaceState(history.state, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  await page.getByRole("button", { name: "One seat more" }).click();
  assert.equal(
    (await events(page, "button_click")).at(-1).properties.control,
    "rendered-card-seats-increase",
  );
  await page.locator('[data-analytics-id="rendered-card-locale-de"]').click();
  assert.equal((await events(page, "demo_locale")).length, 1);
  await page
    .getByRole("button", { name: /^Copy command:/ })
    .first()
    .click();
  assert.equal((await events(page, "code_copy")).length, 1);
  assert.equal(
    (await events(page, "button_click")).length,
    1,
    "A custom action must not also send a generic button event",
  );

  await page.getByRole("link", { name: /Watch the film/ }).click();
  const frame = page.frameLocator('iframe[title="Palamedes product film"]');
  await frame.getByText("Player protocol fixture").waitFor();
  const player = page.frames().find((candidate) => candidate.url().includes("mediadelivery.net"));
  await player.waitForFunction(() => typeof window.emit === "function");
  await player.evaluate(() => window.emit("timeupdate", { seconds: 0, duration: 100 }));
  await page.waitForTimeout(20);
  await player.evaluate(() => window.emit("timeupdate", { seconds: 0.05, duration: 100 }));
  await page.waitForFunction(() => window.__events.some(({ name }) => name === "video_start"));
  assert.equal((await events(page, "video_start")).length, 1);
  await page.getByRole("button", { name: "Close the film" }).click();
  await page.getByRole("link", { name: /Watch the film/ }).click();
  await frame.getByText("Player protocol fixture").waitFor();
  const reopened = page.frames().find((candidate) => candidate.url().includes("mediadelivery.net"));
  await reopened.evaluate(() => window.emit("timeupdate", { seconds: 0, duration: 100 }));
  await page.waitForTimeout(20);
  await reopened.evaluate(() => window.emit("timeupdate", { seconds: 0.05, duration: 100 }));
  await page.getByRole("button", { name: "Close the film" }).click();
  assert.equal(
    (await events(page, "video_start")).length,
    1,
    "Reopening the dialog must preserve per-visit deduplication",
  );

  const search = page.getByRole("combobox").first();
  await search.fill("catalog");
  await page.getByRole("option").first().waitFor();
  await search.press("Enter");
  await page.waitForURL((url) => url.pathname !== "/");
  const searchPageUrl = page.url();
  assert.equal((await events(page, "search_use")).length, 1);
  assert.equal((await events(page, "search_result")).length, 1);
  assert.ok(
    !JSON.stringify(await events(page, "search_use")).includes("catalog"),
    "Search text must not enter the payload",
  );
  await page.goBack();
  await page.waitForURL(`${origin}/`);
  await page.getByRole("button", { name: "One seat more" }).click();
  assert.equal(
    (await events(page, "button_click")).filter(
      ({ properties }) => properties.control === "rendered-card-seats-increase",
    ).length,
    2,
  );
  assert.equal(active.requests(), 1, "SPA navigation must not reinstall the SDK");
  assert.deepEqual(
    (await events(page, "pageview")).map(({ properties }) => properties.page),
    ["/", new URL(searchPageUrl).pathname, "/"],
  );

  await page.goto(`${origin}/get-started`, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Vite + Solid", exact: true }).click();
  await page.waitForFunction(() => window.__events.some(({ name }) => name === "tab_select"));
  assert.equal((await events(page, "tab_select")).length, 1);
  await page.getByRole("tab", { name: "Vite + Solid", exact: true }).press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => window.__events.filter(({ name }) => name === "tab_select").length === 2,
  );
  await page.mouse.move(1300, 600);
  await page.mouse.wheel(0, 20_000);
  await page.waitForFunction(() => window.__events.some(({ name }) => name === "scroll_depth"));
  const depths = await events(page, "scroll_depth");
  assert.equal(new Set(depths.map(({ properties }) => properties.percent)).size, depths.length);

  await page.goto(`${origin}/message-splitting`, { waitUntil: "networkidle" });
  const demo = page.frameLocator('iframe[title="Live message splitting demo"]');
  await demo.getByRole("button", { name: "Projects", exact: true }).click();
  assert.equal((await events(page, "demo_interaction")).length, 1);
  assert.equal(active.requests(), 3, "The embedded demo must not load an additional SDK");
  await demo.getByRole("link", { name: "Français" }).click();
  await demo.getByRole("button", { name: "Billing", exact: true }).click();
  assert.equal((await events(page, "demo_interaction")).at(-1).properties.locale, "fr");
  await active.instance.close();

  for (const options of [{ disabled: true }, { local: true }, { blocked: true }]) {
    const fixture = await context(options);
    await fixture.page.getByRole("button", { name: "One seat more" }).click();
    await fixture.page.getByRole("link", { name: /Watch the film/ }).click();
    await fixture.page
      .frameLocator('iframe[title="Palamedes product film"]')
      .getByText("Player protocol fixture")
      .waitFor();
    await fixture.page.getByRole("button", { name: "Close the film" }).click();
    assert.equal(await fixture.page.getByRole("dialog").count(), 0);
    assert.equal(fixture.requests(), options.blocked ? 1 : 0);
    await fixture.instance.close();
  }
  console.log(
    "Site analytics: semantic events, SPA listener cleanup, iframe events, video deduplication, opt-out, local exclusion, and blocked SDK verified with an isolated sink.",
  );
} finally {
  await browser.close();
  await server.close();
}
