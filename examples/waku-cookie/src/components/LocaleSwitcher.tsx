import { LOCALES, LOCALE_LABELS, type Locale } from "../lib/i18n"

export const LocaleSwitcher = ({ locale }: { locale: Locale }) => {
  return (
    <div className="button-row">
      {LOCALES.map((candidate) => (
        <form action="/set-locale" key={candidate} method="post">
          <button
            className={`chip${candidate === locale ? " active" : ""}`}
            data-testid={`locale-switch-${candidate}`}
            name="locale"
            type="submit"
            value={candidate}
          >
            {LOCALE_LABELS[candidate]}
          </button>
        </form>
      ))}
    </div>
  )
}
