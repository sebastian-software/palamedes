import { ScopeSuspensionProbe } from "./ScopeSuspensionProbe"
import { ClientLocaleBoundary } from "@/components/ClientLocaleBoundary"
import { createActiveServerI18n } from "@/lib/i18n.server"

export default async function RscScopeProbePage() {
  const { locale } = await createActiveServerI18n()

  return (
    <ClientLocaleBoundary locale={locale}>
      <ScopeSuspensionProbe locale={locale} suspensionToken={{}} />
    </ClientLocaleBoundary>
  )
}
