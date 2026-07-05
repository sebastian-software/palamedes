import { useState } from "react"

const COMMAND = "pnpm add -D @palamedes/cli"

export function QuickInstall() {
  const [copied, setCopied] = useState(false)

  return (
    <div className="mt-8 max-w-[26em]">
      <p className="micro text-[10px] tracking-label text-gray-spec">Quick install</p>
      <div className="mt-2 flex items-stretch border border-hair">
        <code className="mono-nums grow bg-paper px-3 py-2.5 text-[12.5px]">{COMMAND}</code>
        <button
          type="button"
          className="micro shrink-0 border-l border-hair px-3 text-[10px] text-gray-spec transition-colors hover:bg-ink hover:text-paper"
          onClick={() => {
            void navigator.clipboard.writeText(COMMAND).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </div>
  )
}
