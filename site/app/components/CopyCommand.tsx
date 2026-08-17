import { useState } from "react"

export function CopyCommand({
  command,
  label,
  className = "",
}: {
  command: string
  label: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)

  return (
    <div className={className}>
      <p className="micro text-[10px] tracking-label text-gray-spec">{label}</p>
      <div className="mt-2 flex items-stretch border border-hair">
        <code className="mono-nums grow bg-paper px-3 py-3 text-[12.5px]">{command}</code>
        <button
          type="button"
          className="micro min-h-11 shrink-0 border-l border-hair px-3 text-[10px] text-gray-spec transition-colors hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          aria-label={`Copy command: ${command}`}
          onClick={() => {
            void navigator.clipboard.writeText(command).then(() => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? `Copied ${command}` : ""}
      </span>
    </div>
  )
}
