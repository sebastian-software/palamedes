type FrameworkMark = { asset: string; width: number; height: number };

const SVELTE_MARK: FrameworkMark = { asset: "svelte.svg", width: 20, height: 24 };

// Dimensions balance the visible artwork, including each asset's clear space.
const MARKS: Partial<Record<string, FrameworkMark>> = {
  react: { asset: "react.svg", width: 28, height: 26 },
  nextjs: { asset: "nextjs-icon.svg", width: 24, height: 24 },
  tanstack: { asset: "tanstack-icon.svg", width: 24, height: 24 },
  solid: { asset: "solid.svg", width: 26, height: 24 },
  waku: { asset: "waku-icon.png", width: 26, height: 26 },
  "react-router": { asset: "react-router-icon.svg", width: 30, height: 20 },
  remix: { asset: "remix-icon.svg", width: 30, height: 18 },
  vite: { asset: "vite-icon.svg", width: 26, height: 26 },
  vue: { asset: "vue.svg", width: 25, height: 23 },
  nuxt: { asset: "nuxt.svg", width: 34, height: 34 },
  svelte: SVELTE_MARK,
  sveltekit: SVELTE_MARK,
  hono: { asset: "hono.svg", width: 24, height: 26 },
  express: { asset: "express-icon.svg", width: 24, height: 24 },
  rust: { asset: "rust.svg", width: 26, height: 26 },
};

/** The visible name identifies the integration; its unmodified mark is decorative. */
export function FrameworkIdentity({ slug, name }: { slug: string; name: string }) {
  const mark = MARKS[slug];
  return (
    <span className="inline-flex min-h-8 items-center gap-2.5 align-middle text-[15px] font-semibold whitespace-nowrap">
      {mark ? (
        <span className="inline-flex size-8 shrink-0 items-center justify-center">
          <img
            src={`/framework-logos/${mark.asset}`}
            alt=""
            aria-hidden="true"
            width={mark.width}
            height={mark.height}
            style={{ width: mark.width, height: mark.height }}
            className="max-w-none shrink-0 object-contain"
            loading="lazy"
            decoding="async"
          />
        </span>
      ) : null}
      <span>{name}</span>
    </span>
  );
}
