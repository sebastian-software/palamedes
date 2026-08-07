// Pure publish-plan helper shared by the container documentation command and
// contract tests. Keeping it matrix-driven prevents published ports from
// drifting away from the supervisor's start plan.
export function buildPublishArgs(examples) {
  return examples.flatMap((example) => ["-p", `${example.port}:${example.port}`])
}
