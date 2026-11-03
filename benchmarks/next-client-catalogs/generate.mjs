// Generates a synthetic Next.js App Router app with many translated client
// components, to compare client catalog delivery modes at build time.
//
//   node benchmarks/next-client-catalogs/generate.mjs [--routes 35] [--components 20] [--locales 10]
import { mkdir, rm, symlink, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const app = path.join(here, ".app");
const { values } = parseArgs({
  options: {
    routes: { type: "string", default: "35" },
    components: { type: "string", default: "20" },
    locales: { type: "string", default: "10" },
  },
});
const routes = Number(values.routes);
const perRoute = Number(values.components);
const locales = ["en", "de", "fr", "es", "it", "nl", "pl", "pt", "sv", "da"].slice(
  0,
  Number(values.locales),
);

const messages = (id) => [
  `Component ${id} heading`,
  `Component ${id} explains what this part of the page does.`,
  `{count, plural, one {# item in component ${id}} other {# items in component ${id}}}`,
];

await rm(app, { recursive: true, force: true });
await mkdir(path.join(app, "src/components"), { recursive: true });
await mkdir(path.join(app, "src/locales"), { recursive: true });
await symlink(
  path.join(repo, "examples/nextjs-route/node_modules"),
  path.join(app, "node_modules"),
);
await cp(path.join(repo, "examples/nextjs-route/tsconfig.json"), path.join(app, "tsconfig.json"));
await writeFile(
  path.join(app, "package.json"),
  JSON.stringify({ name: "next-catalog-bench", private: true, type: "module" }, null, 2),
);
await writeFile(
  path.join(app, "next.config.mjs"),
  `import { withPalamedes } from "@palamedes/next-plugin";

export default withPalamedes(
  { typescript: { ignoreBuildErrors: true } },
  { experimentalClientCatalogAssets: process.env.PALAMEDES_NEXT_CATALOG_ASSETS === "1" },
);
`,
);
await writeFile(
  path.join(app, "palamedes.yaml"),
  `locales: [${locales.join(", ")}]\nsource-locale: en\ncatalogs:\n  - path: src/locales/{locale}\n    include: [src]\n`,
);

const ids = [];
for (let route = 0; route < routes; route += 1) {
  const imports = [];
  const uses = [];
  for (let slot = 0; slot < perRoute; slot += 1) {
    const id = route * perRoute + slot;
    ids.push(id);
    const [heading, body, count] = messages(id);
    await writeFile(
      path.join(app, `src/components/C${id}.tsx`),
      `"use client";

import { useState } from "react";
import { t } from "@palamedes/core/macro";

export function C${id}() {
  const [count, setCount] = useState(1);
  return (
    <section>
      <h2>{t\`${heading}\`}</h2>
      <p>{t\`${body}\`}</p>
      <button type="button" onClick={() => setCount(count + 1)}>
        {t({ message: ${JSON.stringify(count)} }, { count })}
      </button>
    </section>
  );
}
`,
    );
    imports.push(`import { C${id} } from "@/components/C${id}";`);
    uses.push(`      <C${id} />`);
  }
  await mkdir(path.join(app, `src/app/[locale]/r${route}`), { recursive: true });
  await writeFile(
    path.join(app, `src/app/[locale]/r${route}/page.tsx`),
    `${imports.join("\n")}

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <main>
${uses.join("\n")}
    </main>
  );
}
`,
  );
}

await writeFile(
  path.join(app, "src/app/[locale]/layout.tsx"),
  `import { clientCatalogMap } from "@palamedes/next-plugin/server";

export const dynamic = "force-dynamic";

export default async function Layout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const catalogMap = clientCatalogMap(locale);
  return (
    <html lang={locale}>
      <head>
        {catalogMap ? <script id="palamedes-client-catalogs" type="application/json" dangerouslySetInnerHTML={{ __html: catalogMap }} /> : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
`,
);

const escape = (value) => JSON.stringify(value);
for (const locale of locales) {
  const entries = ids.flatMap((id) =>
    messages(id).map((message) => {
      const translated =
        locale === "en"
          ? ""
          : message.startsWith("{count")
            ? message
                .replace("item in", `${locale} item in`)
                .replace("items in", `${locale} items in`)
            : `[${locale}] ${message}`;
      return `msgid ${escape(message)}\nmsgstr ${escape(translated)}\n`;
    }),
  );
  await writeFile(
    path.join(app, `src/locales/${locale}.po`),
    `msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=utf-8\\n"\n"Language: ${locale}\\n"\n\n${entries.join("\n")}`,
  );
}
console.log(
  `Generated ${ids.length} client components across ${routes} routes and ${locales.length} locales in ${app}`,
);
