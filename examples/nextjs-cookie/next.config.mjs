import { withPalamedes } from "@palamedes/next-plugin"

export default withPalamedes(
  {
    allowedDevOrigins: ["127.0.0.1"],
  },
  {
    messageSplitting: true,
    serverFunctions: true,
  }
)
