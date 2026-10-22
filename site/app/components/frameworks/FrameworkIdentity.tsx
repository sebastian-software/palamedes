const MARKS: Partial<Record<string, { className: string; emblem?: boolean }>> = {
  nextjs: { className: "h-6 w-28" },
  tanstack: { className: "h-8 w-20" },
  solid: { className: "h-7 w-8", emblem: true },
  waku: { className: "h-8 w-20 bg-ink px-2 py-1" },
  "react-router": { className: "h-7 w-32" },
  remix: { className: "h-5 w-40" },
  vite: { className: "h-6 w-28" },
  vue: { className: "h-7 w-8", emblem: true },
  nuxt: { className: "h-12 w-12", emblem: true },
  svelte: { className: "h-8 w-7", emblem: true },
  sveltekit: { className: "h-8 w-20" },
};

/** Decorative artwork stays unchanged; the canonical name labels the link. */
export function FrameworkIdentity({ slug, name }: { slug: string; name: string }) {
  const mark = MARKS[slug];
  if (!mark) return <>{name}</>;
  return (
    <span className="inline-flex h-8 items-center gap-2.5 align-middle">
      <span
        className={`inline-flex h-8 shrink-0 items-center ${mark.emblem ? "w-10 justify-center" : "w-40"}`}
      >
        <img
          src={`/framework-logos/${slug}.svg`}
          alt=""
          aria-hidden="true"
          width={128}
          height={32}
          className={`max-w-none shrink-0 object-contain ${mark.className}`}
          loading="lazy"
          decoding="async"
        />
      </span>
      <span className={mark.emblem ? "text-[16px]" : "sr-only"}>{name}</span>
    </span>
  );
}
