import type { NextConfig } from "next";

/*
 * Message assets live next to Next's own chunks under `/_next/static`, so
 * their URLs use the same prefix Next puts in front of `/_next/`: a non-empty
 * `assetPrefix` replaces `basePath` (Next does not join them), and only one
 * trailing slash is removed, exactly like Next's own normalization. Without
 * an `assetPrefix`, Next falls back to `basePath`.
 */
export function clientCatalogPublicPrefix(
  config: Pick<NextConfig, "assetPrefix" | "basePath">,
): string {
  const assetPrefix = config.assetPrefix ?? "";
  if (assetPrefix !== "") {
    return assetPrefix.endsWith("/") ? assetPrefix.slice(0, -1) : assetPrefix;
  }
  return config.basePath ?? "";
}

/*
 * The browser loads message assets with a native `import()`, which always
 * fetches in CORS mode. Next's own chunks are classic `<script>` tags and load
 * cross-origin without CORS headers, so an asset host that serves the chunks
 * fine can still refuse the message assets.
 */
export function crossOriginClientCatalogHost(publicPrefix: string): string | undefined {
  if (!/^(?:[a-z][\d+.a-z-]*:)?\/\//iu.test(publicPrefix)) return;
  try {
    return new URL(publicPrefix, "https://placeholder.invalid").origin;
  } catch {
    return;
  }
}
