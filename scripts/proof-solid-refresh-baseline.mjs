import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(path.join(root, "examples/solid-cookie/package.json"));
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const solidModule = await import(pathToFileURL(require.resolve("@solidjs/vite-plugin")).href);
const solid = solidModule.default.default ?? solidModule.default;
const fixture = await mkdtemp(path.join(root, "examples/solid-cookie/.refresh-baseline-"));
let server;
let browser;
try {
  await mkdir(path.join(fixture, "src"));
  await writeFile(
    path.join(fixture, "index.html"),
    '<div id="root"></div><script type="module" src="/src/entry.tsx"></script>',
  );
  await writeFile(
    path.join(fixture, "src/entry.tsx"),
    'import { render } from "@solidjs/web"; import App from "./App"; render(() => <App/>, document.getElementById("root")!);',
  );
  await writeFile(
    path.join(fixture, "src/catalog.ts"),
    'import { createSignal } from "solid-js"; const [text, setText] = createSignal("Before"); globalThis.updateCatalog = () => setText("After"); export const readCatalog = () => text();',
  );
  const app = (label) => `import { createSignal } from "solid-js";
import { readCatalog } from "./catalog";
export default function App() {
  const [count, setCount] = createSignal(1);
  const captured = readCatalog();
  return <><h1>${label}</h1><p data-testid="reactive">{readCatalog()}</p>
    <p data-testid="captured">{captured}</p>
    <button onClick={() => setCount(count() + 1)}>Add</button><span>{count()}</span></>;
}`;
  const appPath = path.join(fixture, "src/App.tsx");
  await writeFile(appPath, app("Before"));
  server = await createServer({
    root: fixture,
    configFile: false,
    plugins: [solid()],
    server: {
      host: "127.0.0.1",
      port: 24_570,
      strictPort: true,
      watch: { usePolling: true, interval: 100 },
    },
  });
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByRole("button", { name: "Add" }).click();
  await page.evaluate(() => {
    globalThis.__solidBaselineDocument = "retained";
    globalThis.updateCatalog();
  });
  await expect(page.getByTestId("reactive")).toHaveText("After");
  await expect(page.getByTestId("captured")).toHaveText("Before");
  await expect(page.locator("span")).toHaveText("2");
  assert.equal(await page.evaluate(() => globalThis.__solidBaselineDocument), "retained");

  await writeFile(appPath, app("Edited"));
  await expect(page.getByRole("heading")).toHaveText("Edited", { timeout: 15_000 });
  await expect(page.locator("span")).toHaveText("1");
  assert.equal(await page.evaluate(() => globalThis.__solidBaselineDocument), "retained");
  console.log(
    "Solid baseline: reactive reads update in place; component HMR recreates local state",
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(fixture, { recursive: true, force: true });
}
