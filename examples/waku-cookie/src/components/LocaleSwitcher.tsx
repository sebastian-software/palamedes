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
        <form action="/set-locale" key={item.locale} method="post">
          <button
            className={`chip${item.active ? " active" : ""}`}
            data-testid={item.testId}
            name="locale"
            type="submit"
            value={item.locale}
          >
            {item.label}
          </button>
        </form>
      ))}
    </div>
  )
}
