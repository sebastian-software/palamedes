const MARKS: Partial<Record<string, { className: string; emblem?: boolean }>> = {
  nextjs: { className: "h-5 w-24" },
  tanstack: { className: "h-8 w-20" },
  solid: { className: "h-7 w-7", emblem: true },
  waku: { className: "h-8 w-20 bg-ink px-2 py-1" },
  "react-router": { className: "h-6 w-28" },
  remix: { className: "h-5 w-20" },
  vite: { className: "h-5 w-20" },
  vue: { className: "h-6 w-7", emblem: true },
  nuxt: { className: "h-6 w-8", emblem: true },
  svelte: { className: "h-7 w-6", emblem: true },
  sveltekit: { className: "h-8 w-24" },
};

/** Decorative artwork stays unchanged; the canonical name labels the link. */
export function FrameworkIdentity({ slug, name }: { slug: string; name: string }) {
  const mark = MARKS[slug];
  if (!mark) return <>{name}</>;
  return (
    <span className="inline-flex min-h-8 items-center gap-2.5">
      <img
        src={`/framework-logos/${slug}.svg`}
        alt=""
        aria-hidden="true"
        width={128}
        height={32}
        className={`shrink-0 object-contain ${mark.className}`}
        loading="lazy"
        decoding="async"
      />
      <span className={mark.emblem ? "" : "sr-only"}>{name}</span>
    </span>
  );
}
