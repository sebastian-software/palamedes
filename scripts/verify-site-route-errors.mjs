export function isExpectedSkippedViewTransitionError(channel, error) {
  return (
    channel === "pageerror" &&
    error?.name === "AbortError" &&
    error.message === "Transition was skipped"
  )
}
