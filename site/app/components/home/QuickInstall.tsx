import { CopyCommand } from "~/components/CopyCommand"

const COMMAND = "pnpm add -D @palamedes/cli"

export function QuickInstall() {
  return <CopyCommand command={COMMAND} label="Quick install" className="mt-8 max-w-[26em]" />
}
