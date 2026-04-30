import { Link } from "waku"
import { buildLocaleSwitchItems } from "@palamedes/react"
import { LOCALES, LOCALE_LABELS, type Locale } from "../lib/i18n"

export const LocaleSwitcher = ({ locale }: { locale: Locale }) => {
  const localeSwitchItems = buildLocaleSwitchItems({
    locales: LOCALES,
    currentLocale: locale,
    labels: LOCALE_LABELS,
  })

  return (
    <div className="button-row">
      {localeSwitchItems.map((item) => (
        <Link
          className={`chip${item.active ? " active" : ""}`}
          data-testid={item.testId}
          key={item.locale}
          to={`/${item.locale}`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}
