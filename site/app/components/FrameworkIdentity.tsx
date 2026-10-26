type FrameworkMark = {
  asset: string;
  width: number;
  height: number;
  /** Wider slot for an upstream mark with a horizontal canvas. */
  slotWidth?: number;
  /** Transparent space at the artwork's right edge, in display pixels. */
  endInset?: number;
};

const SVELTE_MARK: FrameworkMark = {
  asset: "svelte.svg",
  width: 20,
  height: 24,
  endInset: 1.25,
};

// Preserve the source files; quarter-pixel insets align their painted right edges.
const MARKS: Partial<Record<string, FrameworkMark>> = {
  react: { asset: "react.svg", width: 28, height: 26 },
  nextjs: { asset: "nextjs-icon.svg", width: 24, height: 24 },
  tanstack: { asset: "tanstack-icon.svg", width: 24, height: 24 },
  solid: { asset: "solid.svg", width: 26, height: 24, endInset: 1.75 },
  waku: { asset: "waku-icon.png", width: 26, height: 26 },
  "react-router": { asset: "react-router-icon.svg", width: 30, height: 20 },
  remix: { asset: "remix-icon.svg", width: 30, height: 18 },
  vite: { asset: "vite-icon.svg", width: 26, height: 26, endInset: 0.25 },
  turbopack: { asset: "turbopack-icon.svg", width: 24, height: 24 },
  vue: { asset: "vue.svg", width: 25, height: 23 },
  nuxt: { asset: "nuxt.svg", width: 34, height: 34, endInset: 3 },
  svelte: SVELTE_MARK,
  sveltekit: SVELTE_MARK,
  hono: { asset: "hono.svg", width: 24, height: 26, endInset: 2.75 },
  express: { asset: "express-icon.svg", width: 24, height: 24 },
  rust: { asset: "rust.svg", width: 26, height: 26, endInset: 3.75 },
  mdx: { asset: "mdx.svg", width: 58, height: 24, slotWidth: 58 },
  nodejs: { asset: "nodejs.svg", width: 25, height: 28 },
};

/** The visible name identifies the integration; its unmodified mark is decorative. */
export function FrameworkIdentity({ slug, name }: { slug: string; name: string }) {
  const mark = MARKS[slug];
  return (
    <span
      className="inline-flex min-h-8 items-center align-middle text-[15px] font-semibold whitespace-nowrap"
      style={{ gap: "var(--pmds-identity-gap, 1rem)" }}
    >
      {mark ? (
        <span
          className="inline-flex size-8 shrink-0 items-center"
          style={{
            width: mark.slotWidth
              ? `var(--pmds-identity-wide-slot-width, ${mark.slotWidth}px)`
              : "var(--pmds-identity-slot-width, 32px)",
            justifyContent: "var(--pmds-identity-justify, flex-end)",
          }}
        >
          <img
            src={`/framework-logos/${mark.asset}`}
            alt=""
            aria-hidden="true"
            width={mark.width}
            height={mark.height}
            style={{
              width: mark.width,
              height: mark.height,
              maxWidth: "var(--pmds-identity-mark-max-width, none)",
              transform: `translateX(var(--pmds-identity-inset, ${mark.endInset ?? 0}px))`,
            }}
            className="max-w-none shrink-0 object-contain object-right"
            loading="lazy"
            decoding="async"
          />
        </span>
      ) : null}
      <span>{name}</span>
    </span>
  );
}
