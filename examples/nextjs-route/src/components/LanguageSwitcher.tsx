import Link from "next/link"
import { LOCALE_LABELS, type Locale } from "@/lib/i18n"

const buttonStyle = {
  padding: "0.5rem 1rem",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
  textDecoration: "none",
}

interface LanguageSwitcherProps {
  locale: Locale
  locales: readonly Locale[]
}

export function LanguageSwitcher({ locale, locales }: LanguageSwitcherProps) {
  return (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      {locales.map((loc) => (
        <Link
          key={loc}
          data-testid={`locale-switch-${loc}`}
          href={`/${loc}`}
          style={{
            ...buttonStyle,
            background: locale === loc ? "#0066cc" : "#eee",
            color: locale === loc ? "white" : "black",
          }}
        >
          {LOCALE_LABELS[loc] ?? loc}
        </Link>
      ))}
    </div>
  )
}
