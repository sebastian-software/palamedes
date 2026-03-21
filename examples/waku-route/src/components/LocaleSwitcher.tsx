import { LOCALES, LOCALE_LABELS, type Locale } from "../lib/i18n"

export const LocaleSwitcher = ({ locale }: { locale: Locale }) => {
  return (
    <div className="button-row">
      {LOCALES.map((candidate) => (
        <a
          className={`chip${candidate === locale ? " active" : ""}`}
          data-testid={`locale-switch-${candidate}`}
          href={`/${candidate}`}
          key={candidate}
        >
          {LOCALE_LABELS[candidate]}
        </a>
      ))}
    </div>
  )
}
