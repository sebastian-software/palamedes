import { t } from "@palamedes/core/macro"

export function LocaleSwitcher({ locale }: { locale: string }) {
  return (
    <button type="button">
      {t`Switch locale from ${locale}`}
    </button>
  )
}
