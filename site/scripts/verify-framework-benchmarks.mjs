import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadBlacksmithBenchData } from "../../scripts/blacksmith-bench-data.mjs";

export async function verifyFrameworkBenchmarks(browser, baseUrl, repoRoot) {
  const report = JSON.parse(
    await readFile(
      join(repoRoot, "benchmarks/e2e-workflow/results/frameworks/latest.json"),
      "utf8",
    ),
  );
  const realistic = report.profiles.find((profile) => profile.profile === "realistic");
  const blacksmith = await loadBlacksmithBenchData(repoRoot);
  const artifacts = join(repoRoot, ".vitest-attachments");
  await mkdir(artifacts, { recursive: true });
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
      hasTouch: width < 640,
    });
    try {
      const page = await context.newPage();
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
      const chart = page.locator("#why-rust");
      const local = chart.locator("[data-local-benchmark]");
      if ((await local.getAttribute("open")) === null) await local.locator("summary").click();
      const platforms = chart.locator("#platform-benchmarks");
      await checkPlatform(page, platforms, blacksmith, "react", "linux-x86-64");
      await checkPickerRows(chart, width);
      await platforms.getByRole("radio", { name: "Linux", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await checkPlatform(page, platforms, blacksmith, "react", "macos-arm64");
      await page.keyboard.press("ArrowLeft");
      await checkPlatform(page, platforms, blacksmith, "react", "linux-x86-64");
      await chart
        .getByRole("group", { name: "Benchmark framework", exact: true })
        .evaluate((group) => group.scrollIntoView({ block: "start" }));
      await page.screenshot({
        path: join(artifacts, `benchmark-platform-controls-${width}.png`),
        animations: "disabled",
        style: "header { visibility: hidden !important; }",
      });
      // Native radios must work from the keyboard and replace the whole report:
      // values, rows, command, provenance, and broader-scope note travel together.
      await chart.getByRole("radio", { name: "React", exact: true }).focus();
      for (const framework of ["vue", "svelte", "solid"]) {
        await page.keyboard.press("ArrowRight");
        const label = framework[0].toUpperCase() + framework.slice(1);
        assert.equal(
          await chart.getByRole("radio", { name: label, exact: true }).isChecked(),
          true,
        );
        assert.ok((await platforms.innerText()).includes(`${label} ·`));
        await checkPlatform(
          page,
          platforms,
          blacksmith,
          framework,
          framework === "vue" ? "linux-x86-64" : "macos-arm64",
        );
        // The platform selection and its machine metadata must survive framework changes.
        for (const platform of blacksmith.platforms) {
          const control = platforms.getByRole("radio", { name: platform.label, exact: true });
          if (width < 640) {
            await platforms.getByText(platform.label, { exact: true }).tap();
          } else {
            await control.focus();
            await page.keyboard.press("Space");
          }
          await checkPlatform(page, platforms, blacksmith, framework, platform.id);
        }
        const rows = realistic.results.filter(
          (row) => row.framework === framework && row.status === "validated",
        );
        const table = chart.locator("[data-local-benchmark]").getByRole("table");
        assert.equal(await table.getByRole("row").count(), rows.length + 1);
        for (const row of rows)
          assert.equal(await table.locator(`[data-median-ms="${row.medianMs}"]`).count(), 1);
        assert.equal(await table.getByText("Intlayer", { exact: true }).count(), 0);
        assert.ok((await chart.innerText()).includes("pnpm benchmark:framework-workflow"));
        assert.ok((await chart.innerText()).includes(report.environment.node));
        assert.ok((await chart.innerText()).includes(report.generatedAt.slice(0, 10)));
        assert.equal(
          await table.getByText("extract + update + compile", { exact: true }).count(),
          framework === "vue" ? 0 : 1,
        );
        assert.equal(
          await chart.getByRole("button", { name: "Run it again" }).count(),
          0,
          "Reduced motion must not animate the chart",
        );
        await chart.getByRole("radio", { name: label, exact: true }).focus();
      }
      // Rapid changes must not retain a previous framework's data.
      for (const name of ["Svelte", "Vue"]) {
        const radio = chart.getByRole("radio", { name, exact: true });
        await radio.focus();
        await page.keyboard.press("Space");
      }
      assert.equal(await chart.getByRole("radio", { name: "Vue", exact: true }).isChecked(), true);
      assert.equal(
        await chart
          .locator("[data-local-benchmark]")
          .getByRole("table")
          .getByText("vue3-gettext", { exact: true })
          .count(),
        1,
      );
      const command = chart.getByRole("button", {
        name: "Copy command: pnpm benchmark:framework-workflow",
      });
      assert.equal(await command.count(), 1);
      await chart.screenshot({
        path: join(artifacts, `framework-chart-${width}.png`),
        animations: "disabled",
        style: "header { visibility: hidden !important; }",
      });

      await page.goto(`${baseUrl}/proof#framework-benchmarks`, { waitUntil: "networkidle" });
      await checkTables(page, report);
      const proof = page.locator("#framework-benchmarks");
      await proof
        .locator("section")
        .first()
        .screenshot({
          path: join(artifacts, `framework-table-${width}.png`),
          animations: "disabled",
          style: "header { visibility: hidden !important; }",
        });
      const metrics = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      assert.ok(
        metrics.content <= metrics.viewport + 1,
        `Framework results overflow at ${width}px`,
      );
    } finally {
      await context.close();
    }
  }
  const animated = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  try {
    const page = await animated.newPage();
    await page.goto(`${baseUrl}/#why-rust`, { waitUntil: "networkidle" });
    const chart = page.locator("#why-rust");
    const local = chart.locator("[data-local-benchmark]");
    if ((await local.getAttribute("open")) === null) await local.locator("summary").click();
    for (const label of ["Svelte", "Vue"]) {
      await chart.getByRole("radio", { name: label, exact: true }).focus();
      await page.keyboard.press("Space");
      await local.getByRole("table").scrollIntoViewIfNeeded();
      await chart.getByRole("button", { name: "Running…", exact: true }).waitFor();
    }
    await chart
      .getByRole("button", { name: "Run it again", exact: true })
      .waitFor({ timeout: 10_000 });
    const longest = Math.max(
      ...realistic.results
        .filter((row) => row.framework === "vue" && row.status === "validated")
        .map((row) => row.medianMs),
    );
    assert.equal(
      await chart.getByText(`${(longest / 1000).toFixed(2)} s`, { exact: true }).count(),
      1,
    );
    console.log(
      "  framework chart: switching cancels the previous animation and finishes on the selected report",
    );
  } finally {
    await animated.close();
  }
  const noJs = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  try {
    const home = await noJs.newPage();
    await home.goto(`${baseUrl}/#why-rust`, { waitUntil: "networkidle" });
    assert.equal(await home.locator("#platform-benchmarks").getByRole("columnheader").count(), 2);
    assert.ok((await home.locator("#platform-benchmarks").innerText()).includes("Showing Linux"));
    const local = home.locator("[data-local-benchmark]");
    const wasOpen = (await local.getAttribute("open")) !== null;
    await local.locator("summary").click();
    assert.equal((await local.getAttribute("open")) !== null, !wasOpen);
    await home.close();
    const page = await noJs.newPage();
    await page.goto(`${baseUrl}/proof#framework-benchmarks`, { waitUntil: "networkidle" });
    await checkTables(page, report);
  } finally {
    await noJs.close();
  }
  console.log(
    "  framework benchmarks: keyboard selection, report values, scope, mobile, reduced motion, and no-JS tables passed",
  );
}

async function checkPickerRows(chart, width) {
  for (const name of ["Benchmark framework", "Benchmark platform"]) {
    const group = chart.getByRole("group", { name, exact: true });
    const boxes = await group.locator("label").evaluateAll((labels) =>
      labels.map((label) => {
        const box = label.getBoundingClientRect();
        const text = label.querySelector("span");
        return {
          top: box.top,
          left: box.left,
          right: box.right,
          height: box.height,
          fits: text.scrollWidth <= text.clientWidth,
        };
      }),
    );
    assert.ok(
      boxes.every((box) => Math.abs(box.top - boxes[0].top) < 1),
      `${name} wraps at ${width}px`,
    );
    assert.ok(
      boxes.every((box) => box.left >= 0 && box.right <= width && box.height >= 44 && box.fits),
    );
  }
}

async function checkPlatform(page, region, data, framework, platformId) {
  const platform = data.platforms.find((item) => item.id === platformId);
  assert.equal(
    await region.getByRole("radio", { name: platform.label, exact: true }).isChecked(),
    true,
  );
  assert.equal(await region.getByRole("columnheader").count(), 2);
  assert.equal(
    await region
      .getByRole("columnheader", {
        name: `Median ${platform.label} · ${platform.arch}`,
        exact: true,
      })
      .count(),
    1,
  );
  if (data.status === "pending") return;
  const rows = data.profiles
    .find((item) => item.id === "realistic")
    .frameworks.find((item) => item.id === framework).rows;
  assert.equal(await region.locator("tbody tr").count(), rows.length);
  for (const row of rows) {
    const rendered = region.getByRole("row").filter({
      has: page.getByRole("rowheader", { name: `${row.tool} ${row.scope}`, exact: true }),
    });
    const cell = rendered.getByRole("cell");
    assert.equal(await cell.count(), 1);
    assert.equal(await cell.getAttribute("data-platform"), platformId);
    const value = row.values[platformId];
    assert.equal(
      await cell.getAttribute("data-median-ms"),
      value.status === "validated" ? String(value.medianMs) : null,
    );
    if (value.status !== "validated") assert.ok((await cell.innerText()).includes("Not timed"));
  }
  assert.ok((await region.innerText()).includes(platform.cpu));
  const other = data.platforms.find((item) => item.id !== platformId);
  assert.ok(!(await region.innerText()).includes(other.cpu));
}

async function checkTables(page, report) {
  const section = page.locator("#framework-benchmarks");
  for (const details of await section.locator("details").all())
    await details.locator("summary").click();
  for (const profile of report.profiles)
    for (const framework of ["vue", "svelte", "solid"]) {
      const label = framework[0].toUpperCase() + framework.slice(1);
      const region = section.getByRole("region", {
        name: `${label} ${profile.profile} benchmark results`,
        exact: true,
      });
      assert.equal(await region.isVisible(), true);
      const rows = profile.results.filter((row) => row.framework === framework);
      for (const row of rows.filter((row) => row.status === "validated"))
        assert.equal(await region.locator(`[data-median-ms="${row.medianMs}"]`).count(), 1);
      assert.equal(
        await region.getByRole("columnheader", { name: "Median", exact: true }).count(),
        1,
      );
      assert.equal(await region.getByRole("columnheader").count(), 2);
      assert.equal(await region.getByText("Not timed", { exact: false }).count(), 1);
    }
  const conformance = section.getByRole("region", {
    name: "Intlayer dictionary format conformance",
  });
  assert.equal(await conformance.getByText("25/25", { exact: true }).count(), 3);
  assert.equal(await conformance.getByText("17/25", { exact: true }).count(), 3);
}
