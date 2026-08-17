import npmStats from "~/data/generated/npm-stats.json"
import { NPM } from "~/data/links"

const PACKAGE_BY_PATH: Record<string, string> = {
  "/frameworks/nextjs": "@palamedes/next-plugin",
  "/frameworks/react-router": "@palamedes/react-router-rsc",
  "/frameworks/remix-v3": "@palamedes/remix",
  "/frameworks/solidstart": "@palamedes/solid",
  "/frameworks/tanstack-start": "@palamedes/tanstack",
  "/frameworks/vite": "@palamedes/vite-plugin",
  "/frameworks/waku": "@palamedes/waku",
}

const downloadsFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
})

export function FrameworkPackageStats({ path }: { path: string }) {
  const packageName = PACKAGE_BY_PATH[path]
  const stats = npmStats.packages.find((entry) => entry.name === packageName)
  if (!packageName || !stats) return null

  return (
    <a
      href={NPM(packageName)}
      className="mt-5 grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-5 border-y border-hair px-5 py-3 hover:bg-track focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent max-tight:grid-cols-1 max-tight:gap-2"
      aria-label={`${packageName} on npm`}
    >
      <span>
        <span className="micro block text-[10px] tracking-label text-gray-spec">npm package</span>
        <code className="mt-1 block text-[12px] text-ink">{packageName}</code>
      </span>
      <span className="mono-nums text-[12px] text-accent">
        {stats.version ? `v${stats.version}` : "version unavailable"}
      </span>
      <span className="mono-nums text-[12px] text-ink/75">
        {stats.monthlyDownloads == null
          ? "download count unavailable"
          : `${downloadsFormat.format(stats.monthlyDownloads)} downloads / month`}
      </span>
    </a>
  )
}
