import { withPalamedes } from "@palamedes/next-plugin"

export default withPalamedes(
  {
    allowedDevOrigins: ["127.0.0.1"],
  },
  {
    messageSplitting: true,
    // This example proves that production graph-split chunks contain only the
    // active locale. Keep development's missing-translation probe readable,
    // but opt into compact production output for that assertion.
    keepSourceFallbacks: process.env.NODE_ENV !== "production",
    serverFunctions: true,
  }
)
