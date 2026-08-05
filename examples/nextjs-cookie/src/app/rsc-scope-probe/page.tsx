import { ScopeSuspensionProbe } from "./ScopeSuspensionProbe"
import { createActiveServerI18n } from "@/lib/i18n.server"

export default async function RscScopeProbePage() {
  const { locale } = await createActiveServerI18n()

  return <ScopeSuspensionProbe locale={locale} suspensionToken={{}} />
}
