import { withPalamedes } from "@palamedes/next-plugin"

export default withPalamedes(
  {},
  {
    messageSplitting: true,
    serverFunctions: true,
  }
)
