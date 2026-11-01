import { createElement } from "ardo/react";
import { renderToStaticMarkup } from "ardo/react-dom/server";
import { describe, expect, it } from "vitest";

import type { PlatformBenchmarkData } from "../../data/blacksmith-bench";
import { PlatformBenchmarks } from "./PlatformBenchmarks";

const pending: PlatformBenchmarkData = {
  status: "pending",
  profiles: [],
  platforms: [
    { id: "linux-x86-64", label: "Linux", arch: "x86-64" },
    { id: "macos-arm64", label: "macOS", arch: "ARM64" },
  ],
};
const measured: PlatformBenchmarkData = {
  ...pending,
  status: "measured",
  revision: "a".repeat(40),
  runUrl: "https://example.test/run/1",
  reportPath: "benchmarks/e2e-workflow/results/blacksmith/latest.json",
  profiles: [
    {
      id: "realistic",
      frameworks: [
        {
          id: "vue",
          rows: [
            {
              tool: "Palamedes",
              version: "1.25.1",
              scope: "extract + catalog update",
              values: {
                "linux-x86-64": { status: "validated", medianMs: 31.2 },
                "macos-arm64": { status: "validated", medianMs: 47.8 },
              },
            },
            {
              tool: "Intlayer",
              version: "9.7.0",
              scope: "extract + update + compile",
              values: {
                "linux-x86-64": { status: "not-equivalent" },
                "macos-arm64": { status: "not-equivalent" },
              },
            },
          ],
        },
      ],
    },
  ],
};

describe("platform benchmark table", () => {
  it("links the selected platform's campaign instead of another platform's run", () => {
    const data = structuredClone(measured);
    data.platforms[0].runUrl = "https://example.test/linux-retry";
    data.platforms[1].runUrl = "https://example.test/macos-run";
    const html = renderToStaticMarkup(
      createElement(PlatformBenchmarks, { framework: "vue", data }),
    );
    expect(html).toContain('href="https://example.test/linux-retry"');
    expect(html).not.toContain('href="https://example.test/macos-run"');
    expect(html).not.toContain(`href="${measured.runUrl}"`);
  });
  it("prerenders platform controls and explicit missing results without timing placeholders", () => {
    const html = renderToStaticMarkup(
      createElement(PlatformBenchmarks, { framework: "react", data: pending }),
    );
    expect(html).toContain("Linux");
    expect(html).toContain("macOS");
    expect(html).toContain("have not been published yet");
    expect(html).not.toContain("data-median-ms");
    expect(html.match(/scope="col"/gu)).toHaveLength(2);
    expect(html.match(/type="radio"/gu)).toHaveLength(2);
    expect(html).toContain("<caption");
  });

  it("shows only the selected platform's median and keeps failed checks untimed", () => {
    const html = renderToStaticMarkup(
      createElement(PlatformBenchmarks, { framework: "vue", data: measured }),
    );
    expect(html).toContain('data-platform="linux-x86-64" data-median-ms="31.2"');
    expect(html).not.toContain('data-platform="macos-arm64"');
    expect(html).toContain("31 ms");
    expect(html).toContain('data-tool-version="1.25.1"');
    expect(html).toContain("v1.25.1");
    expect(html).toContain("v9.7.0");
    expect(html).not.toContain("48 ms");
    expect(html.match(/data-median-ms=/gu)).toHaveLength(1);
    expect(html.match(/Not timed/gu)).toHaveLength(1);
    expect(html).toContain("extract + update + compile");
    expect(html).toContain(`/tree/${measured.revision}`);
    expect(html).not.toMatch(/min.?max/iu);
  });
});
