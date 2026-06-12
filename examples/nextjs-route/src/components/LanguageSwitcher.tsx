import Link from "next/link"
import { buildLocaleSwitchItems } from "@palamedes/react"
import { LOCALE_LABELS, type Locale } from "@/lib/i18n"

const buttonStyle = {
  padding: "0.5rem 1rem",
  border: "none",
  borderRadius: "4px",
  cursor: "pointer",
  textDecoration: "none",
}

type LanguageSwitcherProps = {
  locale: Locale
  locales: readonly Locale[]
}

export function LanguageSwitcher({ locale, locales }: LanguageSwitcherProps) {
  const localeSwitchItems = buildLocaleSwitchItems({
    locales,
    currentLocale: locale,
    labels: LOCALE_LABELS,
  })

  return (
    <div style={{ display: "flex", gap: "0.5rem" }}>
      {localeSwitchItems.map((item) => (
        <Link
          key={item.locale}
          data-testid={item.testId}
          href={`/${item.locale}`}
          style={{
            ...buttonStyle,
            background: item.active ? "#0066cc" : "#eee",
            color: item.active ? "white" : "black",
          }}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}
