import {
  ArrowLeftRight,
  BookOpen,
  Bot,
  Braces,
  Compass,
  Cookie,
  Fingerprint,
  Flag,
  GitMerge,
  Globe,
  PenLine,
  Plug,
  Route,
  Server,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from "lucide-react"

import type { FeatureIconName } from "~/data/features"

const ICONS: Record<FeatureIconName, LucideIcon> = {
  pen: PenLine,
  fingerprint: Fingerprint,
  plug: Plug,
  cookie: Cookie,
  route: Route,
  globe: Globe,
  flag: Flag,
  book: BookOpen,
  compass: Compass,
  server: Server,
  arrows: ArrowLeftRight,
  wrench: Wrench,
  robot: Bot,
  shield: ShieldCheck,
  brackets: Braces,
  merge: GitMerge,
}

export function FeatureIcon({
  name,
  className = "",
}: {
  name: FeatureIconName
  className?: string
}) {
  const Icon = ICONS[name]
  return <Icon size={20} strokeWidth={1.25} className={className} aria-hidden />
}
