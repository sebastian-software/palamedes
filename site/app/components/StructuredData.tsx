/** Keep structured data in the prerendered document and escape HTML delimiters. */
export function StructuredData({ data }: { data: object | object[] }) {
  return (Array.isArray(data) ? data : [data]).map((entry) => {
    const json = JSON.stringify(entry).replaceAll("<", "\\u003c");
    return (
      <script key={json} type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
    );
  });
}
