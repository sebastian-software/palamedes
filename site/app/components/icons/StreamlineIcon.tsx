export type StreamlineIconName =
  | "app-widgets-plugin-extension"
  | "browser-check"
  | "browser-flash"
  | "code-analysis"
  | "deployment-workflow-collaboration"
  | "globe-app-network"
  | "programming-book"
  | "web-hierarchy"

export function StreamlineIcon({
  name,
  className = "",
}: {
  name: StreamlineIconName
  className?: string
}) {
  return (
    <img
      src={`/icons/streamline/sharp-duo/${name}.svg`}
      width={24}
      height={24}
      alt=""
      className={className}
      aria-hidden
    />
  )
}
