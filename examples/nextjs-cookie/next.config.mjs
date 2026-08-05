import { withPalamedes } from "@palamedes/next-plugin"

export default withPalamedes(
  {},
  {
    serverFunctions: {
      initializer: "@/lib/i18n.server#initServerActionI18n",
    },
  }
)
