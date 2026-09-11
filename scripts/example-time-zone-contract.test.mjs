import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE_ROOT = path.join(REPOSITORY_ROOT, "examples/nextjs-route");
const EXAMPLE_RENDER_PROBE = `
  import { createElement, Fragment } from "react"
  import { renderToStaticMarkup } from "react-dom/server"
  import { Trans } from "@palamedes/react"
  import { setClientI18n } from "@palamedes/runtime"
  import { createServerI18nScope } from "@palamedes/runtime/server"
  import { EVENT } from "@palamedes/example-ui"
  import { createI18n, defineCompiledCatalog } from "@palamedes/core"
  import { compileTestMessages } from "../../scripts/test-support/compiled-messages.mjs"

  const i18n = createI18n({ locale: "en", timeZone: "Europe/Berlin" })
  i18n.load("en", defineCompiledCatalog(compileTestMessages({
    date: "{when, date, full}",
    time: "{when, time, short}",
  })))
  const when = new Date(EVENT.startsAt)
  const render = () =>
    renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(Trans, { id: "date", values: { when } }),
        " ",
        createElement(Trans, { id: "time", values: { when } })
      )
    )
  const serverOutput = createServerI18nScope().run(i18n, render)
  globalThis.window = {}
  setClientI18n(i18n)
  const clientOutput = render()

  console.log(
    JSON.stringify({ clientOutput, instant: when.toISOString(), serverOutput, timeZone: i18n.timeZone })
  )
`;

function renderNextExample(hostTimeZone) {
  const output = execFileSync(
    process.execPath,
    ["--experimental-strip-types", "--input-type=module", "--eval", EXAMPLE_RENDER_PROBE],
    {
      cwd: EXAMPLE_ROOT,
      encoding: "utf8",
      env: { ...process.env, TZ: hostTimeZone },
    },
  );
  return JSON.parse(output.trim());
}

describe("Next.js route example time-zone contract", () => {
  it("renders native compiled date and time messages across server/client host zones", () => {
    const losAngeles = renderNextExample("America/Los_Angeles");
    const tokyo = renderNextExample("Asia/Tokyo");
    const instant = new Date("2026-09-18T17:30:00Z");
    const expectedOutput = `${new Intl.DateTimeFormat("en", {
      dateStyle: "full",
      timeZone: "Europe/Berlin",
    }).format(instant)} ${new Intl.DateTimeFormat("en", {
      timeStyle: "short",
      timeZone: "Europe/Berlin",
    }).format(instant)}`;

    expect(losAngeles).toStrictEqual(tokyo);
    expect(losAngeles).toStrictEqual({
      clientOutput: expectedOutput,
      instant: "2026-09-18T17:30:00.000Z",
      serverOutput: expectedOutput,
      timeZone: "Europe/Berlin",
    });
  });
});
