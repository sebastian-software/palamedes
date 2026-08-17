import type { FeatureIconName } from "~/data/features"
import { StreamlineIcon, type StreamlineIconName } from "~/components/icons/StreamlineIcon"

const ICONS: Record<FeatureIconName, StreamlineIconName> = {
  pen: "code-analysis",
  fingerprint: "code-analysis",
  plug: "deployment-workflow-collaboration",
  cookie: "globe-app-network",
  route: "web-hierarchy",
  globe: "globe-app-network",
  flag: "globe-app-network",
  book: "programming-book",
  compass: "globe-app-network",
  server: "web-hierarchy",
  arrows: "deployment-workflow-collaboration",
  wrench: "code-analysis",
  robot: "app-widgets-plugin-extension",
  shield: "browser-check",
  brackets: "code-analysis",
  merge: "deployment-workflow-collaboration",
}

export function FeatureIcon({
  name,
  className = "",
}: {
  name: FeatureIconName
  className?: string
}) {
  return <StreamlineIcon name={ICONS[name]} className={className} />
}
