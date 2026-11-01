import { createElement } from "ardo/react";
import { renderToStaticMarkup } from "ardo/react-dom/server";
import { describe, expect, it } from "vitest";

import { StructuredData } from "../components/StructuredData";
import { faqStructuredData, frameworkStructuredData, pageMeta } from "./meta";

describe("static page metadata", () => {
  it("keeps the canonical URL and social image in Ardo's supported descriptors", () => {
    const metadata = pageMeta({ title: "Guide", description: "A guide.", path: "/docs/guide" });
    expect(metadata).toContainEqual({
      tagName: "link",
      rel: "canonical",
      href: "https://palamedes.dev/docs/guide",
    });
    expect(metadata).toContainEqual({
      property: "og:image",
      content: "https://palamedes.dev/og-image.png",
    });
    expect(metadata.every((entry) => !("script:ld+json" in entry))).toBe(true);
  });

  it("prerenders readable FAQ schema while escaping script delimiters", () => {
    const schema = faqStructuredData([
      { q: "How is code escaped?", a: "Use </script> as literal text." },
    ]);
    const html = renderToStaticMarkup(createElement(StructuredData, { data: schema }));
    expect(html).not.toContain("Use </script>");
    const json = html.match(/<script[^>]*>([\s\S]*?)<\/script>/u)?.[1];
    expect(JSON.parse(json ?? "null")).toEqual(schema);
  });

  it("keeps each framework schema separately readable without client JavaScript", () => {
    const data = frameworkStructuredData({
      title: "React i18n",
      description: "A working integration.",
      path: "/frameworks/react",
      framework: "React",
      faq: [{ q: "Supported?", a: "Yes." }],
    });
    const html = renderToStaticMarkup(createElement(StructuredData, { data }));
    const schemas = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gu)].map(([, json]) =>
      JSON.parse(json),
    );
    expect(schemas.map((entry) => entry["@type"])).toEqual([
      "TechArticle",
      "FAQPage",
      "BreadcrumbList",
    ]);
    expect(schemas[2].itemListElement[1].item).toBe("https://palamedes.dev/frameworks/react");
  });
});
