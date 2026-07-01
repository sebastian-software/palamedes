// Builds the README hero image: one demo, rendered in three locales side by
// side, proving the localization story (text, plural, currency, date all
// change) rather than repeating ten near-identical framework screenshots.
//
// Usage: serve any example, then run with its port. Example:
//   pnpm --filter @palamedes/example-tanstack-cookie preview &
//   node scripts/build-readme-hero.mjs --port 4020 --out docs/site/assets/palamedes-localized-matrix.png
import { chromium } from "@playwright/test"
import { writeFileSync } from "node:fs"
import path from "node:path"

const args = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? fallback : args[i + 1]
}
const PORT = arg("port", "4020")
const OUT = path.resolve(arg("out", "docs/site/assets/palamedes-localized-matrix.png"))
const EXE = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
const BASE = `http://127.0.0.1:${PORT}/`

const LOCALES = [
  { code: "en", label: "English", note: "€149.00 · Sep 18" },
  { code: "de", label: "Deutsch", note: "149,00 € · 18. Sept." },
  { code: "es", label: "Español", note: "149,00 € · 18 sept." },
]

const browser = await chromium.launch({ executablePath: EXE, headless: true })

async function shotLocale(code) {
  const ctx = await browser.newContext({
    viewport: { width: 720, height: 1120 },
    deviceScaleFactor: 2,
    colorScheme: "light",
  })
  await ctx.addCookies([{ name: "locale", value: code, url: BASE }])
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60_000 })
  const buf = await page.screenshot({ clip: { x: 0, y: 0, width: 720, height: 1120 } })
  await ctx.close()
  return `data:image/png;base64,${buf.toString("base64")}`
}

const shots = {}
for (const { code } of LOCALES) {
  shots[code] = await shotLocale(code)
  console.log("captured", code)
}

const cards = LOCALES.map(
  ({ code, label, note }) => `
  <figure class="card">
    <img src="${shots[code]}" alt="Palamedes demo in ${label}" />
    <figcaption><span class="lang">${label}</span><span class="note">${note}</span></figcaption>
  </figure>`
).join("")

const composite = `<!doctype html><html><head><meta charset="utf-8" />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet" />
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: "Hanken Grotesk", sans-serif; background: oklch(97.5% 0.012 75); color: oklch(22% 0.02 285); padding: 3rem 3rem 2.4rem; width: 2560px; }
  .head { max-width: 60rem; margin-bottom: 2rem; }
  .kick { font-size: 0.85rem; letter-spacing: 0.16em; text-transform: uppercase; font-weight: 700; color: oklch(57% 0.19 32); margin-bottom: 0.8rem; }
  h1 { font-family: "Fraunces", serif; font-weight: 500; font-size: 3.1rem; line-height: 1.03; letter-spacing: -0.025em; }
  h1 em { font-style: italic; color: oklch(49% 0.18 32); }
  .sub { font-size: 1.15rem; color: oklch(42% 0.02 285); margin-top: 0.9rem; max-width: 52rem; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.6rem; }
  .card { background: oklch(99% 0.008 80); border: 1px solid oklch(86% 0.012 75); border-radius: 18px; overflow: hidden; box-shadow: 0 1px 2px oklch(30% 0.05 285 / 0.06), 0 18px 40px -24px oklch(30% 0.05 285 / 0.3); }
  .card img { display: block; width: 100%; border-bottom: 1px solid oklch(91% 0.01 75); }
  figcaption { display: flex; align-items: baseline; justify-content: space-between; padding: 0.85rem 1.2rem; }
  .lang { font-family: "Fraunces", serif; font-weight: 600; font-size: 1.25rem; }
  .note { font-family: "JetBrains Mono", monospace; font-size: 0.82rem; color: oklch(52% 0.018 285); }
  .foot { margin-top: 1.8rem; font-size: 1rem; color: oklch(42% 0.02 285); display: flex; align-items: center; gap: 0.6rem; }
  .foot b { font-family: "Fraunces", serif; font-weight: 600; }
</style></head>
<body>
  <div class="head">
    <p class="kick">Browser-verified example matrix</p>
    <h1>One i18n model, <em>every language</em>, every framework.</h1>
    <p class="sub">The same booking, rendered by the same runtime. Switch locale and the copy, plural seat counts, currency, and dates all change together.</p>
  </div>
  <div class="grid">${cards}</div>
  <p class="foot"><b>Pixel-identical</b> across Next.js · TanStack Start · SolidStart · Waku · React Router, in cookie and route locale strategies, each browser-verified in CI.</p>
</body></html>`

const tmpHtml = path.resolve(".readme-hero-composite.html")
writeFileSync(tmpHtml, composite)
const ctx = await browser.newContext({ deviceScaleFactor: 2, colorScheme: "light" })
const page = await ctx.newPage()
await page.goto(`file://${tmpHtml}`, { waitUntil: "networkidle" })
await page.waitForTimeout(600)
const el = await page.locator("body")
await el.screenshot({ path: OUT })
console.log("wrote", OUT)
await browser.close()
writeFileSync(tmpHtml, "")
