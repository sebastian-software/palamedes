import type { ArdoMetaDescriptor } from "ardo/runtime";

import { SITE_ORIGIN } from "~/data/links";
type Faq = readonly { q: string; a: string }[];
type PageMetadata = { title: string; description: string; path: string; image?: string; faq?: Faq };
type TopicMetadata = PageMetadata & { faq: Faq; slug: string };
type FrameworkMetadata = PageMetadata & { faq: Faq; framework: string };

export function pageMeta({
  title,
  description,
  path,
  image = "/og-image.png",
}: PageMetadata): ArdoMetaDescriptor[] {
  const url = path === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${path}`;
  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "Palamedes" },
    { property: "og:url", content: url },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: `${SITE_ORIGIN}${image}` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { name: "twitter:card", content: "summary_large_image" },
  ];
}

export function topicMeta(page: TopicMetadata) {
  return pageMeta({ ...page, image: `/og/${page.slug}.png` });
}

export function frameworkMeta(page: FrameworkMetadata) {
  return pageMeta(page);
}

/** JSON-LD is rendered as a script in the page, including without JavaScript. */
export function faqStructuredData(faq: Faq) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

function articleStructuredData({ title, description, path }: PageMetadata) {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    description,
    url: `${SITE_ORIGIN}${path}`,
    inLanguage: "en",
    isAccessibleForFree: true,
    publisher: {
      "@type": "Organization",
      name: "Sebastian Software GmbH",
      url: SITE_ORIGIN,
    },
  };
}

export function topicStructuredData(page: PageMetadata & { faq: Faq }) {
  return [articleStructuredData(page), faqStructuredData(page.faq)];
}

export function frameworkStructuredData(page: FrameworkMetadata) {
  return [
    {
      ...articleStructuredData(page),
      about: {
        "@type": "SoftwareApplication",
        name: page.framework,
        applicationCategory: "DeveloperApplication",
      },
    },
    faqStructuredData(page.faq),
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Frameworks", item: `${SITE_ORIGIN}/frameworks` },
        {
          "@type": "ListItem",
          position: 2,
          name: page.framework,
          item: `${SITE_ORIGIN}${page.path}`,
        },
      ],
    },
  ];
}
