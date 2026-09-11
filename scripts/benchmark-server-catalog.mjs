import { fork } from "node:child_process";
import { performance } from "node:perf_hooks";
import process from "node:process";

import { createI18n, defineCompiledCatalog } from "../packages/core/dist/index.mjs";

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
const coldCatalogLoadMs = performance.now() - coldStart;

const firstRequestStart = performance.now();
createRequest(coldSnapshot, "locale-0", 0);
const firstRequestMs = performance.now() - firstRequestStart;

const warmStart = performance.now();
for (let index = 0; index < requestCount; index += 1) {
  createRequest(coldSnapshot, "locale-0", index);
}
const warmRequestMs = performance.now() - warmStart;

const mixedStart = performance.now();
await Promise.all(
  Array.from({ length: requestCount }, async (_, index) => {
    const locale = `locale-${index % localeCount}`;
    createRequest(await store.load(locale), locale, index);
  }),
);
const mixedLocaleMs = performance.now() - mixedStart;

let sharedRequestLoadEnumerations = 0;
const originalEntries = Object.entries;
const originalKeys = Object.keys;
Object.keys = (...args) => {
  sharedRequestLoadEnumerations += 1;
  return originalKeys(...args);
};
Object.entries = (...args) => {
  sharedRequestLoadEnumerations += 1;
  return originalEntries(...args);
};
let sharedHeap;
try {
  sharedHeap = measureRetainedHeap(() => {
    const requests = [];
    for (let index = 0; index < requestCount; index += 1) {
      requests.push(createRequest(coldSnapshot, "locale-0", index));
    }
    return requests;
  });
} finally {
  Object.entries = originalEntries;
  Object.keys = originalKeys;
}

let baselineRequestMessageEntries = 0;
const baselineHeap = measureRetainedHeap(() => {
  const requests = [];
  const source = catalogs.get("locale-0");
  for (let index = 0; index < requestCount; index += 1) {
    const requestCatalog = defineCompiledCatalog({ ...source });
    baselineRequestMessageEntries += Object.keys(requestCatalog).length;
    requests.push(createRequest(requestCatalog, "locale-0", index));
  }
  return requests;
});

const moduleRetention = await measureModuleRetention();
const concurrentColdMs = await measureConcurrentColdLoads();
const workers = await measureWorkers();
const messageSizeSweep = await measureMessageSizes();
const stats = store.stats();
const result = {
  fixture: { localeCount, messageCount, requestCount },
  coldCatalogLoadMs,
  firstRequestMs,
  warmRequestMs,
  warmRequestMsPerRequest: warmRequestMs / requestCount,
  mixedLocaleMs,
  sharedCatalog: {
    ...stats,
    catalogEnumerationsDuringRequestLoads: sharedRequestLoadEnumerations,
    retainedHeapDeltaBytes: sharedHeap.deltaBytes,
  },
  perRequestMapBaseline: {
    requestMessageEntriesAllocated: baselineRequestMessageEntries,
    retainedHeapDeltaBytes: baselineHeap.deltaBytes,
  },
  esmModuleRetention: moduleRetention,
  concurrentColdMs,
  workers,
  messageSizeSweep,
};

if (result.sharedCatalog.catalogEnumerationsDuringRequestLoads !== 0) {
  throw new Error(
    "The shared-catalog regression guard detected catalog enumeration during request loads.",
  );
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

function createRequest(catalog, locale, index) {
  const i18n = createI18n({
    locale,
    timeZone: index % 2 === 0 ? "UTC" : "Europe/Berlin",
  });
  i18n.load(locale, catalog);
  return { i18n, rendered: i18n._("message-0") };
}

function parseMessageSizes() {
  const configured = process.env.PALAMEDES_BENCH_MESSAGE_SIZES;
  const sizes = (configured ? configured.split(",") : [100, messageCount, messageCount * 5])
    .map((value) => Number(typeof value === "string" ? value.trim() : value))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return [...new Set(sizes)];
}

async function measureMessageSizes() {
  const results = [];
  for (const size of messageSizes) {
    const catalogsForSize = createCatalogs(size);
    const sizeStore = createServerCatalogStore({
      async load({ locale }) {
        return [catalogsForSize.get(locale)];
      },
    });
    const coldStart = performance.now();
    const snapshot = await sizeStore.load("locale-0");
    const coldCatalogLoadMs = performance.now() - coldStart;
    const warmStart = performance.now();
    for (let index = 0; index < requestCount; index += 1) {
      createRequest(snapshot, "locale-0", index);
    }
    const warmRequestMs = performance.now() - warmStart;
    results.push({
      messageCount: size,
      coldCatalogLoadMs,
      warmRequestMs,
      warmRequestMsPerRequest: warmRequestMs / requestCount,
      retainedMessages: sizeStore.stats().retainedMessages,
    });
  }
  return results;
}

async function measureConcurrentColdLoads() {
  const coldStore = createServerCatalogStore({
    async load({ locale }) {
      return [catalogs.get(locale)];
    },
  });
  const start = performance.now();
  await Promise.all(
    Array.from(catalogs.keys(), async (locale, index) => {
      createRequest(await coldStore.load(locale), locale, index);
    }),
  );
  return performance.now() - start;
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
    const catalog = Object.fromEntries(
      Array.from({ length: messageCount }, (_, messageIndex) => [
        `message-${messageIndex}`,
        `Locale ${index} message ${messageIndex}`,
      ]),
    );
    const source = `export const catalog = Object.freeze(${JSON.stringify(catalog)});`;
    await import(`data:text/javascript,${encodeURIComponent(source)}#locale=${index}`);
  }
  collectGarbage();
  return {
    localesImported: localeCount,
    retainedHeapDeltaBytes: process.memoryUsage().heapUsed - before,
    messageCount,
    note: "ESM module caching may retain every used locale catalog for the process lifetime.",
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
