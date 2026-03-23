import { Link } from "waku"
import { LOCALES, LOCALE_LABELS, type Locale } from "../lib/i18n"

export const LocaleSwitcher = ({ locale }: { locale: Locale }) => {
  return (
    <div className="button-row">
      {LOCALES.map((candidate) => (
        <Link
          className={`chip${candidate === locale ? " active" : ""}`}
          data-testid={`locale-switch-${candidate}`}
          key={candidate}
          to={`/${candidate}`}
        >
          {LOCALE_LABELS[candidate]}
        </Link>
      ))}
    </div>
  )
}
