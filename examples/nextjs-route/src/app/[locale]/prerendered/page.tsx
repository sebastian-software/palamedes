import { t } from "@palamedes/core/macro";
import { notFound } from "next/navigation";
import { ClientReady } from "@/components/ClientReady";
import { TicketFaq } from "@/components/TicketFaq";
import { TicketPanel } from "@/components/TicketPanel";
import { createActiveServerI18n, runWithServerI18n } from "@/lib/i18n.server";
import { locales } from "@/lib/i18n";

/*
 * Prerendered at build time for every locale from the layout's
 * generateStaticParams(). It reads no request data, so Next renders it in its
 * build workers; the permutation build has to select locale chunks there too.
 */
export const dynamic = "error";

function translateHeadline(): string {
  return t`Prerendered at build time`;
}

export default async function PrerenderedPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!locales.isLocale(locale)) {
    notFound();
  }
  const { i18n } = await createActiveServerI18n(locale);

  return runWithServerI18n(i18n, () => (
    <main className="page-shell">
      <section className="hero">
        <h1>{translateHeadline()}</h1>
      </section>
      <div className="grid">
        <TicketPanel locale={locale} />
        <TicketFaq />
      </div>
      <ClientReady />
    </main>
  ));
}
