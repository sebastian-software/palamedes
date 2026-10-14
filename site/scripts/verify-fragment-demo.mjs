import assert from "node:assert/strict";
import axe from "axe-core";

const fragmentPattern = /\/fragment-demo\/assets\/palamedes-m-.*\.(en|fr)-.*\.js$/u;

export async function verifyFragmentDemo(browser, baseUrl) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    // Let the prerendered iframe finish before the parent attaches its listener.
    await page.route("**/*.js", async (route) => {
      if (!new URL(route.request().url()).pathname.startsWith("/assets/")) return route.continue();
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({ response });
    });
    await page.goto(`${baseUrl}/message-splitting`, { waitUntil: "networkidle" });
    await page.unrouteAll();
    await page.waitForFunction(() => {
      const frame = document.querySelector("iframe");
      return (
        frame.clientHeight >=
        frame.contentDocument.getElementById("root").getBoundingClientRect().height - 1
      );
    });
    await page.getByRole("heading", { name: "Load the view. Load its messages." }).waitFor();
    const frame = page.frameLocator('iframe[title="Live message splitting demo"]');
    for (const locale of ["en", "fr"]) {
      if (locale === "fr") {
        requests.length = 0;
        await frame.getByRole("link", { name: "Français", exact: true }).click();
      }
      const evidence = await (
        await context.request.get(`${baseUrl}/fragment-demo/evidence.${locale}.json`)
      ).json();
      const loaded = frame.locator("[data-fragment]");
      await loaded.first().waitFor();
      assert.equal(await loaded.evaluate((element) => element.dataset.fragment), "overview");
      assert.equal(await loaded.count(), 1);
      assert.equal(
        await frame
          .getByRole("heading", {
            name:
              locale === "en"
                ? "Your workspace at a glance"
                : "Votre espace de travail en un coup d'œil",
          })
          .count(),
        1,
      );
      const expected = [];
      for (const view of ["overview", "projects", "billing"]) {
        if (view !== "overview") {
          const button = frame.getByRole("button", {
            name: view === "projects" ? "Projects" : "Billing",
            exact: true,
          });
          await button.focus();
          await page.keyboard.press("Enter");
          await frame.locator(`[data-fragment="${view}"]`).waitFor();
        }
        expected.push(evidence.fragments.find((fragment) => fragment.view === view));
        assert.ok(
          (await frame.locator(`[data-fragment="${view}"]`).textContent()).includes(
            view === "overview"
              ? "Entry"
              : `Navigation · ${view === "projects" ? "Projects" : "Billing"}`,
          ),
          "The ledger must attribute each request to entry or its navigation",
        );
        const paths = expected.map((fragment) => `/fragment-demo/${fragment.file}`);
        assert.deepEqual(
          requests.filter((path) => fragmentPattern.test(path)).sort(),
          paths.sort(),
          "Only visited views and the active locale may load fragments",
        );
        assert.ok(
          !requests.some((path) => /\/whole\./u.test(path)),
          "The demo must not fetch the comparison catalog",
        );
        assert.equal(
          await frame.locator("[data-loaded-messages]").textContent(),
          `${new Set(expected.flatMap((fragment) => fragment.ids)).size} / ${evidence.whole.messages} messages`,
        );
        assert.equal(
          await frame.locator("[data-loaded-bytes]").textContent(),
          `${(expected.reduce((sum, fragment) => sum + fragment.bytes, 0) / 1024).toFixed(2)} KiB`,
        );
        // Compare the build receipt with the actual delivered file, not a hardcoded claim.
        const asset = await context.request.get(`${baseUrl}/fragment-demo/${expected.at(-1).file}`);
        assert.equal((await asset.body()).byteLength, expected.at(-1).bytes);
      }
      await frame.getByRole("button", { name: "Overview", exact: true }).click();
      await frame.getByRole("status").filter({ hasText: "Showing Overview" }).waitFor();
      assert.equal(
        requests.filter((path) => fragmentPattern.test(path)).length,
        3,
        "Returning to a loaded view must not fetch a fragment again",
      );
      assert.equal(await loaded.count(), 3);
      const reference = await context.request.get(
        `${baseUrl}/fragment-demo/${evidence.whole.file}`,
      );
      assert.equal((await reference.body()).byteLength, evidence.whole.bytes);
      const demoFrame = page
        .frames()
        .find((candidate) => candidate.url().endsWith(`/${locale}.html`));
      await demoFrame.addScriptTag({ content: axe.source });
      const violations = await demoFrame.evaluate(
        async () =>
          (
            await globalThis.axe.run(document, {
              runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] },
            })
          ).violations,
      );
      assert.deepEqual(
        violations.map((violation) => violation.id),
        [],
        "The embedded demo must pass Axe",
      );
    }
    await page.setViewportSize({ width: 320, height: 844 });
    const demoFrame = page.frames().find((candidate) => candidate.url().endsWith("/fr.html"));
    assert.equal(
      await demoFrame.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      true,
      "The demo must fit a 320px viewport",
    );
    await page.waitForFunction(() => {
      const frame = document.querySelector("iframe");
      return (
        frame.clientHeight >=
        frame.contentDocument.getElementById("root").getBoundingClientRect().height - 1
      );
    });
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
  }

  const failureContext = await browser.newContext();
  const failurePage = await failureContext.newPage();
  try {
    const evidence = await (
      await failureContext.request.get(`${baseUrl}/fragment-demo/evidence.en.json`)
    ).json();
    const projects = evidence.fragments.find((fragment) => fragment.view === "projects");
    await failurePage.route(`**/fragment-demo/${projects.file}`, (route) =>
      route.fulfill({ status: 503, body: "unavailable" }),
    );
    await failurePage.goto(`${baseUrl}/fragment-demo/en.html`, { waitUntil: "networkidle" });
    await failurePage.getByRole("button", { name: "Projects", exact: true }).click();
    await failurePage.getByRole("alert").waitFor();
    assert.equal(
      await failurePage.getByRole("heading", { name: "Your workspace at a glance" }).count(),
      1,
      "A failed lazy fragment must preserve the previous view",
    );
    assert.equal(
      await failurePage.locator('[data-fragment="projects"]').count(),
      0,
      "A failed response must not be reported as loaded",
    );
    await failurePage.unrouteAll();
    await failurePage.getByRole("link", { name: "Reload the demo to try again" }).click();
    await failurePage.getByRole("button", { name: "Projects", exact: true }).click();
    await failurePage.getByRole("heading", { name: "Projects in progress" }).waitFor();
    await failurePage.locator('[data-fragment="projects"]').waitFor();
    const overview = evidence.fragments.find((fragment) => fragment.view === "overview");
    await failurePage.route(`**/fragment-demo/${overview.file}`, (route) =>
      route.fulfill({ status: 503, body: "unavailable" }),
    );
    await failurePage.goto(`${baseUrl}/fragment-demo/en.html`, { waitUntil: "networkidle" });
    await failurePage
      .getByRole("heading", { name: "This page is temporarily unavailable." })
      .waitFor();
    assert.equal(
      await failurePage.getByRole("button", { name: "Projects", exact: true }).count(),
      0,
    );
    await failurePage.unrouteAll();
    await failurePage.getByRole("link", { name: "Reload page", exact: true }).click();
    await failurePage.getByRole("heading", { name: "Your workspace at a glance" }).waitFor();
    console.log(
      "fragment-demo: entry, navigation, reuse, locale isolation, byte receipts, accessibility, mobile, and failure recovery passed",
    );
  } finally {
    await failureContext.close();
  }
}
