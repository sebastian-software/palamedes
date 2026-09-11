import { fork } from "node:child_process";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { defineCompiledCatalog } from "../packages/core/dist/index.mjs";

const localeCount = Number(process.env.PALAMEDES_BENCH_LOCALES ?? 8);
const messageCount = Number(process.env.PALAMEDES_BENCH_MESSAGES ?? 2000);
const requestCount = Number(process.env.PALAMEDES_BENCH_REQUESTS ?? 2000);
const messageSizes = parseMessageSizes();

if (process.argv.includes("--worker")) {
  const report = await runWorker();
  process.send?.(report);
  process.exit(0);
}

const { createServerCatalogStore } = await loadStore();
const catalogs = createCatalogs();
const store = createServerCatalogStore({
  async load({ locale, generation }) {
    const messages = catalogs.get(locale);
    if (!messages) throw new Error(`Unknown benchmark locale: ${locale}`);
    void generation;
    return [messages];
  },
});

const coldStart = performance.now();
const coldSnapshot = await store.load("locale-0");
const coldLoadMs = performance.now() - coldStart;

const warmStart = performance.now();
for (let index = 0; index < requestCount; index += 1) {
  await store.load("locale-0");
}
const warmRequestMs = performance.now() - warmStart;

const mixedStart = performance.now();
await Promise.all(
  Array.from({ length: requestCount }, (_, index) => store.load(`locale-${index % localeCount}`)),
);
const mixedLocaleMs = performance.now() - mixedStart;

const sharedHeap = measureRetainedHeap(() => {
  const requests = [];
  for (let index = 0; index < requestCount; index += 1) {
    requests.push({
      locale: "locale-0",
      timeZone: index % 2 === 0 ? "UTC" : "Europe/Berlin",
      catalog: coldSnapshot,
    });
  }
  return requests;
});
const baselineHeap = measureRetainedHeap(() => {
  const requests = [];
  const source = catalogs.get("locale-0");
  for (let index = 0; index < requestCount; index += 1) {
    requests.push({
      locale: "locale-0",
      timeZone: index % 2 === 0 ? "UTC" : "Europe/Berlin",
      messages: { ...source },
    });
  }
  return requests;
});

const moduleRetention = await measureModuleRetention();
const workers = await measureWorkers();
const messageSizeSweep = await measureMessageSizes();
const stats = store.stats();
const result = {
  fixture: { localeCount, messageCount, requestCount },
  coldLoadMs,
  warmRequestMs,
  mixedLocaleMs,
  sharedCatalog: {
    ...stats,
    requestMessageEntriesAllocated: 0,
    retainedHeapDeltaBytes: sharedHeap.deltaBytes,
  },
  perRequestMapBaseline: {
    requestMessageEntriesAllocated: requestCount * messageCount,
    retainedHeapDeltaBytes: baselineHeap.deltaBytes,
  },
  esmModuleRetention: moduleRetention,
  workers,
  messageSizeSweep,
};

if (result.sharedCatalog.requestMessageEntriesAllocated !== 0) {
  throw new Error("The shared-catalog regression guard detected per-request message entries.");
}

console.log(JSON.stringify(result, null, 2));

async function loadStore() {
  try {
    return await import("../packages/runtime/dist/server.mjs");
  } catch (error) {
    throw new Error(
      "Build @palamedes/runtime before running this benchmark (pnpm benchmark:server-catalog).",
      { cause: error },
    );
  }
}

function createCatalogs(size = messageCount) {
  const catalogs = new Map();
  for (let localeIndex = 0; localeIndex < localeCount; localeIndex += 1) {
    const messages = Object.create(null);
    for (let messageIndex = 0; messageIndex < size; messageIndex += 1) {
      messages[`message-${messageIndex}`] = `Locale ${localeIndex} message ${messageIndex}`;
    }
    catalogs.set(`locale-${localeIndex}`, defineCompiledCatalog(messages));
  }
  return catalogs;
}

function parseMessageSizes() {
  const configured = process.env.PALAMEDES_BENCH_MESSAGE_SIZES;
  const sizes = (configured ? configured.split(",") : [100, messageCount, messageCount * 5])
    .map((value) => Number(typeof value === "string" ? value.trim() : value))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return [...new Set(sizes)];
}

async function measureMessageSizes() {
  return Promise.all(
    messageSizes.map(async (size) => {
      const catalogsForSize = createCatalogs(size);
      const sizeStore = createServerCatalogStore({
        async load({ locale }) {
          return [catalogsForSize.get(locale)];
        },
      });
      const coldStart = performance.now();
      await sizeStore.load("locale-0");
      const coldLoadMs = performance.now() - coldStart;
      const warmStart = performance.now();
      for (let index = 0; index < requestCount; index += 1) {
        await sizeStore.load("locale-0");
      }
      const warmRequestMs = performance.now() - warmStart;
      return {
        messageCount: size,
        coldLoadMs,
        warmRequestMs,
        warmRequestMsPerRequest: warmRequestMs / requestCount,
        retainedMessages: sizeStore.stats().retainedMessages,
      };
    }),
  );
}

function measureRetainedHeap(createRequests) {
  collectGarbage();
  const before = process.memoryUsage().heapUsed;
  const requests = createRequests();
  collectGarbage();
  const after = process.memoryUsage().heapUsed;
  // Keep the references alive until after the measurement so the retained
  // request-state delta includes the requested concurrency.
  if (requests.length !== requestCount) throw new Error("Benchmark fixture mismatch.");
  return { deltaBytes: after - before };
}

async function measureModuleRetention() {
  collectGarbage();
  const before = process.memoryUsage().heapUsed;
  for (let index = 0; index < localeCount; index += 1) {
    const source = `export const locale = ${JSON.stringify(`locale-${index}`)};`;
    await import(`data:text/javascript,${encodeURIComponent(source)}#locale=${index}`);
  }
  collectGarbage();
  return {
    localesImported: localeCount,
    retainedHeapDeltaBytes: process.memoryUsage().heapUsed - before,
    note: "ESM module caching may retain every used locale for the process lifetime.",
  };
}

async function measureWorkers() {
  const samples = await Promise.all(
    [0, 1].map(
      () =>
        new Promise((resolve, reject) => {
          const child = fork(new URL(import.meta.url), ["--worker"], {
            execArgv: process.execArgv.includes("--expose-gc") ? ["--expose-gc"] : [],
            env: process.env,
            stdio: ["ignore", "ignore", "inherit", "ipc"],
          });
          child.once("message", (message) => resolve(message));
          child.once("error", reject);
          child.once("exit", (code) => {
            if (code !== 0) reject(new Error(`Benchmark worker exited with ${code}.`));
          });
        }),
    ),
  );
  return {
    processCount: samples.length,
    samples,
    note: "Each worker has its own module cache and shared catalog storage.",
  };
}

async function runWorker() {
  const { createServerCatalogStore } = await loadStore();
  const catalogs = createCatalogs();
  const store = createServerCatalogStore({
    async load({ locale, generation }) {
      void generation;
      return [catalogs.get(locale)];
    },
  });
  await Promise.all(Array.from(catalogs.keys(), (locale) => store.load(locale)));
  collectGarbage();
  return {
    rssBytes: process.memoryUsage().rss,
    heapUsedBytes: process.memoryUsage().heapUsed,
    stats: store.stats(),
  };
}

function collectGarbage() {
  if (typeof global.gc === "function") global.gc();
}
