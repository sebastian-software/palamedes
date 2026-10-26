#!/usr/bin/env node
/*
 * Publish a film cut to Bunny Stream and point the site at it.
 *
 * Bunny Stream does not replace the file of an existing video, so every cut
 * becomes a new video: create it, upload (or let Bunny fetch) the master, wait
 * for encoding, set the poster as its thumbnail, and add English captions.
 * With --site, the script then rewrites site/app/data/film.ts (id, version,
 * duration, transcript), copies the poster into site/public/media, and updates
 * the film line in site/analytics.md. The previous video stays in the library
 * as a rollback; delete it in the dashboard once the new cut is live.
 *
 * Only the account API key is needed (BUNNY_API_KEY, from the environment or
 * --env): the library's own key is read from the account API and never printed.
 *
 * usage (from video/):
 *   node scripts/publish-bunny.mjs --dry-run --file <master.mp4> --poster <poster.webp> \
 *     --captions <film.en.vtt> --version v7 [--env ../.env] [--site]
 *   node scripts/publish-bunny.mjs --url <https://…/master.mp4> … (Bunny fetches it)
 */
import {
  createReadStream,
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const VIDEO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = resolve(VIDEO, "../site");
const FILM_TS = join(SITE, "app/data/film.ts");
const POSTER_PATH = join(SITE, "public/media/palamedes-film-poster.webp");
const ANALYTICS = join(SITE, "analytics.md");
const ACCOUNT_API = "https://api.bunny.net";
const STREAM_API = "https://video.bunnycdn.com";
// Bunny Stream video status codes.
const FINISHED = 4;
const FAILED = new Set([5, 6]);

const { values: args } = parseArgs({
  options: {
    file: { type: "string" },
    url: { type: "string" },
    poster: { type: "string" },
    captions: { type: "string" },
    version: { type: "string" },
    title: { type: "string" },
    cues: { type: "string", default: join(VIDEO, "audio/cues/film.json") },
    env: { type: "string" },
    library: { type: "string" },
    site: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});

const fail = (message) => {
  console.error(`publish-bunny: ${message}`);
  process.exit(1);
};

if (Boolean(args.file) === Boolean(args.url)) fail("pass exactly one of --file or --url");
if (!args.poster || !args.captions || !args.version)
  fail("--poster, --captions and --version are required");
for (const path of [args.file, args.poster, args.captions, args.cues].filter(Boolean)) {
  if (!existsSync(path)) fail(`missing file: ${path}`);
}
if (args.url && !args.url.startsWith("https://"))
  fail("--url must be an https URL Bunny can reach");
if (args.site && !args.poster.endsWith(".webp")) fail("--site needs a WebP poster for the site");

function accountKey() {
  if (process.env.BUNNY_API_KEY) return process.env.BUNNY_API_KEY;
  if (args.env) {
    for (const line of readFileSync(args.env, "utf8").split("\n")) {
      if (line.startsWith("BUNNY_API_KEY="))
        return line
          .slice(14)
          .trim()
          .replace(/^["']|["']$/gu, "");
    }
  }
  return fail("set BUNNY_API_KEY or pass --env");
}

async function call(base, path, key, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { AccessKey: key, Accept: "application/json", ...init.headers },
  });
  const text = await response.text();
  if (!response.ok)
    fail(`${init.method ?? "GET"} ${path}: HTTP ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

const film = readFileSync(FILM_TS, "utf8");
const current = film.match(/embed\/(\d+)\/([0-9a-f-]{36})/u);
if (!current) fail(`cannot find the player URL in ${FILM_TS}`);
const [, currentLibrary, currentId] = current;
const library = args.library ?? currentLibrary;
const cues = JSON.parse(readFileSync(args.cues, "utf8"));
const seconds = Math.round(cues.total);
const duration = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const transcript = cues.cues.map((cue) => cue.text).filter(Boolean);
const title = args.title ?? `Palamedes — Product film ${args.version}`;

const key = accountKey();
const libraryInfo = await call(ACCOUNT_API, `/videolibrary/${library}`, key);
const streamKey = libraryInfo.ApiKey;
if (!streamKey) fail("the account API returned no library key; check the key's permissions");
const previous = await call(STREAM_API, `/library/${library}/videos/${currentId}`, streamKey);

console.log(`library   ${library} (${libraryInfo.Name})`);
console.log(`current   ${currentId} "${previous.title}" (status ${previous.status})`);
console.log(`new       "${title}", ${duration}, ${transcript.length} transcript lines`);
console.log(
  `source    ${args.file ? `${args.file} (${(statSync(args.file).size / 1e6).toFixed(1)} MB)` : args.url}`,
);
console.log(`poster    ${args.poster}`);
console.log(`captions  ${args.captions} (en)`);
console.log(`site      ${args.site ? "update film.ts, poster, analytics.md" : "unchanged"}`);
if (args["dry-run"]) {
  console.log("dry run: nothing uploaded or changed");
  process.exit(0);
}

let id;
if (args.file) {
  ({ guid: id } = await call(STREAM_API, `/library/${library}/videos`, streamKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  }));
  console.log(`created   ${id}; uploading…`);
  await call(STREAM_API, `/library/${library}/videos/${id}`, streamKey, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: createReadStream(args.file),
    duplex: "half",
  });
} else {
  const fetched = await call(STREAM_API, `/library/${library}/videos/fetch`, streamKey, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: args.url, title }),
  });
  id = fetched.id ?? fetched.guid;
  if (!id) {
    const found = await call(
      STREAM_API,
      `/library/${library}/videos?search=${encodeURIComponent(title)}&orderBy=date`,
      streamKey,
    );
    id = found.items?.find((item) => item.title === title)?.guid;
  }
  if (!id) fail("Bunny accepted the fetch but the new video could not be found by title");
  console.log(`fetching  ${id} from ${args.url}`);
}

for (let waited = 0; ; waited += 10) {
  const video = await call(STREAM_API, `/library/${library}/videos/${id}`, streamKey);
  if (video.status === FINISHED) break;
  if (FAILED.has(video.status)) fail(`encoding failed for ${id} (status ${video.status})`);
  if (waited > 1800) fail(`encoding of ${id} did not finish within 30 minutes`);
  process.stdout.write(`encoding  status ${video.status}, ${video.encodeProgress ?? 0}%\r`);
  await new Promise((done) => setTimeout(done, 10_000));
}
console.log(`encoded   ${id}                    `);

await call(STREAM_API, `/library/${library}/videos/${id}/thumbnail`, streamKey, {
  method: "POST",
  headers: { "Content-Type": "application/octet-stream" },
  body: readFileSync(args.poster),
});
await call(STREAM_API, `/library/${library}/videos/${id}/captions/en`, streamKey, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    label: "English",
    captionsFile: readFileSync(args.captions).toString("base64"),
  }),
});
console.log("poster and captions set");

if (args.site) {
  const lines = transcript.map((line) => `  ${JSON.stringify(line)},`).join("\n");
  const next = film
    .replaceAll(currentId, id)
    .replace(/version: "v\d+"/u, `version: "${args.version}"`)
    .replace(/duration: "\d+:\d\d"/u, `duration: "${duration}"`)
    .replace(/PalamedesFilm from video\/, \d+:\d\d/u, `PalamedesFilm from video/, ${duration}`)
    .replace(/(FILM_TRANSCRIPT: readonly string\[\] = \[\n)[\s\S]*?\n\];/u, `$1${lines}\n];`);
  writeFileSync(FILM_TS, next);
  copyFileSync(args.poster, POSTER_PATH);
  writeFileSync(
    ANALYTICS,
    readFileSync(ANALYTICS, "utf8").replace(
      /film is `[0-9a-f-]{36}`, version `v\d+`/u,
      `film is \`${id}\`, version \`${args.version}\``,
    ),
  );
  console.log(
    "site      film.ts, poster, and analytics.md updated; run the formatter and open a PR",
  );
}
console.log(`done      https://player.mediadelivery.net/embed/${library}/${id}`);
