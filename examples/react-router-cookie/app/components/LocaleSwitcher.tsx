import { Form, useNavigation } from "react-router"
import { buildLocaleSwitchItems } from "@palamedes/react"
import { Trans } from "@palamedes/react/macro"
import type { Locale } from "~/lib/i18n"
import { LOCALES, LOCALE_LABELS } from "~/lib/i18n"

type LocaleSwitcherProps = {
  locale: Locale
}

export function LocaleSwitcher({ locale }: LocaleSwitcherProps) {
  const navigation = useNavigation()
  const isPending = navigation.state !== "idle"
  const items = buildLocaleSwitchItems({
    locales: LOCALES,
    currentLocale: locale,
    labels: LOCALE_LABELS,
  })

  return (
    <div className="switcher">
      <span className="switcher-label">
        <Trans>Locale</Trans>
      </span>
      {/*
       * A document navigation, deliberately: with import-map locale binding
       * the active locale's message assets are fixed by the import map in the
       * document head, so switching locales means loading a new document with
       * the new map. The action sets the cookie and redirects.
       */}
      <Form method="post" reloadDocument className="seg" role="group" aria-label="Language">
        <input type="hidden" name="intent" value="set-locale" />
        {items.map((item) => (
          <button
            key={item.locale}
            data-testid={item.testId}
            aria-pressed={item.active}
            disabled={isPending}
            name="locale"
            value={item.locale}
            type="submit"
          >
            {item.locale.toUpperCase()}
          </button>
        ))}
      </Form>
    </div>
  )
}
