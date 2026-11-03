import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "@palamedes/example-ui/styles.css";
import { PalamedesClientCatalogs } from "@palamedes/next-plugin/server";
import { LOCALES, locales } from "@/lib/i18n";

export const metadata: Metadata = {
  title: "Next.js Route Locale Example",
  description: "Route-driven locale proof for Palamedes on the Next.js App Router",
};

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Unknown /:locale segments must 404 instead of rendering fallback content
  // under an indexable URL.
  if (!locales.isLocale(locale)) {
    notFound();
  }

  return (
    <html lang={locale} data-palamedes-time-zone="Europe/Berlin">
      <head>
        <PalamedesClientCatalogs locale={locale} />
      </head>
      <body>{children}</body>
    </html>
  );
}
