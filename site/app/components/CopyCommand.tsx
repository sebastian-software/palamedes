import { useEffect, useRef, useState } from "react"

type CopyState = "copied" | "failed" | null

async function writeCommand(command: string) {
  try {
    const clipboard = navigator.clipboard
    if (clipboard) {
      await clipboard.writeText(command)
      return
    }
  } catch {
    // Clipboard permission is optional; continue with the browser fallback.
  }

  const activeElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  const textarea = document.createElement("textarea")
  textarea.value = command
  textarea.readOnly = true
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.append(textarea)
  textarea.select()
  let copied = false
  try {
    copied = document.execCommand("copy")
  } finally {
    textarea.remove()
    activeElement?.focus()
  }

  if (!copied) throw new Error("The browser did not copy the command")
}

export function CopyCommand({
  command,
  label,
  className = "",
}: {
  command: string
  label: string
  className?: string
}) {
  const commandRef = useRef<HTMLElement>(null)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const activationRef = useRef(0)
  const [copyState, setCopyState] = useState<CopyState>(null)

  useEffect(
    () => () => {
      activationRef.current += 1
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = null
    },
    []
  )

  function showCopyState(activation: number, state: Exclude<CopyState, null>) {
    if (activation !== activationRef.current) return
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    setCopyState(state)
    resetTimerRef.current = setTimeout(() => {
      if (activation !== activationRef.current) return
      setCopyState(null)
      resetTimerRef.current = null
    }, 1500)
  }

  function selectCommand() {
    if (!commandRef.current) return
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(commandRef.current)
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  return (
    <div className={className}>
      <p className="micro text-[10px] tracking-label text-gray-spec">{label}</p>
      <div className="mt-2 flex items-stretch border border-hair">
        <code ref={commandRef} className="mono-nums grow bg-paper px-3 py-3 text-[12.5px]">
          {command}
        </code>
        <button
          type="button"
          className="micro min-h-11 shrink-0 border-l border-hair px-3 text-[10px] text-gray-spec transition-colors hover:bg-ink hover:text-paper focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          aria-label={`Copy command: ${command}`}
          onClick={async () => {
            const activation = ++activationRef.current
            try {
              await writeCommand(command)
              showCopyState(activation, "copied")
            } catch {
              if (activation !== activationRef.current) return
              selectCommand()
              showCopyState(activation, "failed")
            }
          }}
        >
          {copyState === "copied" ? "copied" : copyState === "failed" ? "selected" : "copy"}
        </button>
      </div>
      <span className="sr-only" role="status" aria-live="polite">
        {copyState === "copied"
          ? `Copied ${command}`
          : copyState === "failed"
            ? `Copy unavailable. Selected ${command} for manual copy.`
            : ""}
      </span>
    </div>
  )
}
